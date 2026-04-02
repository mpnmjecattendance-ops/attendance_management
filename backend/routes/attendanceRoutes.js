import express from 'express';
import { supabase } from '../utils/supabaseClient.js';
import {
    ATTENDANCE_PERIODS,
    createLocalTimestamp,
    formatLocalDate,
    getAttendanceSettings,
    getCompletedAttendancePeriods,
    getLocalDateBounds,
    getLocalDayOfWeek
} from '../services/attendanceSettingsService.js';
import { syncAbsencesForToday } from '../services/attendanceSyncService.js';
import { getHolidays } from '../services/calendarService.js';
import { REVIEW_STATUS } from '../services/reviewService.js';

const router = express.Router();
const STUDENT_SELECT = 'id, name, register_number, dob, blood_group, address, year, semester, department_id, is_active, created_at';
const STUDENT_SELECT_FALLBACK = 'id, name, register_number, dob, blood_group, address, year, semester, department_id, created_at';
const ALLOWED_OVERRIDE_STATUSES = new Set(['Present', 'Absent', 'Late', 'On Duty']);

const getPeriodTimestamp = (date, period) => {
    if ((period || '').toLowerCase() === 'morning') {
        return createLocalTimestamp(date, '09:00:00');
    }

    if ((period || '').toLowerCase() === 'evening') {
        return createLocalTimestamp(date, '16:00:00');
    }

    return createLocalTimestamp(date, '12:00:00');
};

const applyStudentFilters = (query, {
    studentId = null,
    departmentId = null,
    parsedYear = null,
    parsedSemester = null
}) => {
    let nextQuery = query;

    if (studentId) {
        nextQuery = nextQuery.eq('id', studentId);
    }

    if (departmentId) {
        nextQuery = nextQuery.eq('department_id', departmentId);
    }

    if (parsedYear) {
        nextQuery = nextQuery.eq('year', parsedYear);
    }

    if (parsedSemester) {
        nextQuery = nextQuery.eq('semester', parsedSemester);
    }

    return nextQuery;
};

const fetchFilteredStudents = async (filters, { activeOnly = false } = {}) => {
    let query = applyStudentFilters(
        supabase
            .from('students')
            .select(STUDENT_SELECT)
            .order('name', { ascending: true }),
        filters
    );

    if (activeOnly) {
        query = query.eq('is_active', true);
    }

    let { data, error } = await query;

    if (error?.message?.includes('is_active')) {
        let fallbackQuery = applyStudentFilters(
            supabase
                .from('students')
                .select(STUDENT_SELECT_FALLBACK)
                .order('name', { ascending: true }),
            filters
        );

        ({ data, error } = await fallbackQuery);

        if (!error) {
            data = (data || []).map((student) => ({ ...student, is_active: true }));
        }
    }

    if (error) {
        throw new Error(error.message);
    }

    return data || [];
};

const getDateRange = (fromDate, toDate) => {
    const dates = [];
    const cursor = new Date(`${fromDate}T12:00:00.000Z`);
    const end = new Date(`${toDate}T12:00:00.000Z`);

    while (cursor <= end) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return dates;
};

const buildAttendanceKey = (studentId, date, period) => `${studentId}::${date}::${period}`;

const getCompletedPeriodsForDate = ({ date, today, now, settings, holidayDates }) => {
    if (date > today || holidayDates.has(date)) {
        return [];
    }

    const dayOfWeek = getLocalDayOfWeek(new Date(createLocalTimestamp(date, '12:00:00')));
    if (dayOfWeek === 0) {
        return [];
    }

    if (date < today) {
        return ATTENDANCE_PERIODS.map(({ period }) => period);
    }

    return getCompletedAttendancePeriods(settings, now);
};

router.get('/report', async (req, res) => {
    try {
        const {
            date,
            studentId,
            departmentId,
            year,
            semester,
            fromDate,
            toDate
        } = req.query;
        const requestedDate = typeof date === 'string' ? date : null;
        const normalizedFromDate = typeof fromDate === 'string' ? fromDate : requestedDate;
        const normalizedToDate = typeof toDate === 'string' ? toDate : requestedDate;
        const reportNow = new Date();
        const today = formatLocalDate(reportNow);
        const shouldSyncToday = (!normalizedFromDate && !normalizedToDate) ||
            (
                (!normalizedFromDate || normalizedFromDate <= today) &&
                (!normalizedToDate || normalizedToDate >= today)
            );

        if (normalizedFromDate && normalizedToDate && normalizedFromDate > normalizedToDate) {
            return res.status(400).json({ error: 'From date cannot be later than to date.' });
        }

        const parsedYear = typeof year === 'string' && year.trim() ? Number(year) : null;
        const parsedSemester = typeof semester === 'string' && semester.trim() ? Number(semester) : null;

        if ((year && Number.isNaN(parsedYear)) || (semester && Number.isNaN(parsedSemester))) {
            return res.status(400).json({ error: 'Year and semester filters must be numeric.' });
        }

        if (shouldSyncToday) {
            try {
                await syncAbsencesForToday();
            } catch (syncError) {
                console.error('Attendance sync before report failed:', syncError.message);
            }
        }

        let filteredStudentIds = null;
        let synthStudents = [];
        const hasStudentFilters = Boolean(studentId || departmentId || parsedYear || parsedSemester);
        const studentFilters = {
            studentId,
            departmentId,
            parsedYear,
            parsedSemester
        };

        if (hasStudentFilters) {
            const matchingStudents = await fetchFilteredStudents(studentFilters);
            filteredStudentIds = (matchingStudents || []).map((student) => student.id);
            synthStudents = (matchingStudents || []).filter((student) => student.is_active !== false);

            if (filteredStudentIds.length === 0) {
                return res.json({ report: [] });
            }
        } else {
            synthStudents = await fetchFilteredStudents(studentFilters, { activeOnly: true });
        }

        let query = supabase
            .from('attendance')
            .select('*')
            .order('timestamp', { ascending: false });

        if (filteredStudentIds) {
            query = query.in('student_id', filteredStudentIds);
        }

        if (normalizedFromDate) {
            const { start } = getLocalDateBounds(normalizedFromDate);
            query = query.gte('timestamp', start.toISOString());
        }

        if (normalizedToDate) {
            const { end } = getLocalDateBounds(normalizedToDate);
            query = query
                .lte('timestamp', end.toISOString());
        }

        const { data: attendanceRecords, error } = await query;

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        const effectiveFromDate = normalizedFromDate || today;
        const effectiveToDate = normalizedToDate || today;
        const settings = await getAttendanceSettings();
        const holidayDates = new Set(
            (await getHolidays({ fromDate: effectiveFromDate, toDate: effectiveToDate }))
                .filter((holiday) => holiday.is_holiday)
                .map((holiday) => holiday.date)
        );
        const existingAttendanceKeys = new Set(
            (attendanceRecords || [])
                .filter((record) => record.student_id && record.period)
                .map((record) => buildAttendanceKey(
                    record.student_id,
                    formatLocalDate(new Date(record.timestamp)),
                    record.period
                ))
        );
        const pendingReviewKeys = new Set();
        const synthStudentIds = synthStudents.map((student) => student.id).filter(Boolean);

        if (synthStudentIds.length > 0) {
            const { start: reviewStart } = getLocalDateBounds(effectiveFromDate);
            const { end: reviewEnd } = getLocalDateBounds(effectiveToDate);
            const { data: pendingReviews, error: pendingReviewsError } = await supabase
                .from('recognition_reviews')
                .select('candidate_student_id, period, created_at')
                .eq('status', REVIEW_STATUS.PENDING)
                .in('candidate_student_id', synthStudentIds)
                .gte('created_at', reviewStart.toISOString())
                .lte('created_at', reviewEnd.toISOString());

            if (pendingReviewsError && !pendingReviewsError.message?.includes('recognition_reviews')) {
                return res.status(400).json({ error: pendingReviewsError.message });
            }

            for (const review of pendingReviews || []) {
                if (!review.candidate_student_id || !review.period) {
                    continue;
                }

                pendingReviewKeys.add(buildAttendanceKey(
                    review.candidate_student_id,
                    formatLocalDate(new Date(review.created_at)),
                    review.period
                ));
            }
        }

        const derivedAbsences = [];
        for (const reportDate of getDateRange(effectiveFromDate, effectiveToDate)) {
            const completedPeriods = getCompletedPeriodsForDate({
                date: reportDate,
                today,
                now: reportNow,
                settings,
                holidayDates
            });

            for (const period of completedPeriods) {
                for (const student of synthStudents) {
                    const studentCreatedDate = student.created_at ? formatLocalDate(new Date(student.created_at)) : null;
                    if (studentCreatedDate && reportDate < studentCreatedDate) {
                        continue;
                    }

                    const attendanceKey = buildAttendanceKey(student.id, reportDate, period);

                    if (existingAttendanceKeys.has(attendanceKey) || pendingReviewKeys.has(attendanceKey)) {
                        continue;
                    }

                    derivedAbsences.push({
                        id: `derived-${student.id}-${reportDate}-${period.toLowerCase()}`,
                        student_id: student.id,
                        session_id: null,
                        status: 'Absent',
                        period,
                        timestamp: getPeriodTimestamp(reportDate, period),
                        marked_by: null,
                        source: 'auto_absent',
                        confidence: null,
                        review_id: null,
                        notes: 'Attendance was not recorded for this completed period.',
                        is_derived: true
                    });
                    existingAttendanceKeys.add(attendanceKey);
                }
            }
        }

        const reportRows = [...(attendanceRecords || []), ...derivedAbsences];
        const studentIds = [...new Set(reportRows.map((record) => record.student_id).filter(Boolean))];
        const sessionIds = [...new Set(reportRows.map((record) => record.session_id).filter(Boolean))];
        const studentsById = new Map();
        const sessionsById = new Map();

        if (studentIds.length > 0) {
            const { data: students, error: studentsError } = await supabase
                .from('students')
                .select('id, name, register_number, dob, blood_group, address, year, semester, department_id')
                .in('id', studentIds);

            if (studentsError) {
                return res.status(400).json({ error: studentsError.message });
            }

            const departmentIds = [...new Set((students || []).map((student) => student.department_id).filter(Boolean))];
            const departmentsById = new Map();

            if (departmentIds.length > 0) {
                const { data: departments, error: departmentsError } = await supabase
                    .from('departments')
                    .select('id, name')
                    .in('id', departmentIds);

                if (departmentsError) {
                    return res.status(400).json({ error: departmentsError.message });
                }

                for (const department of departments || []) {
                    departmentsById.set(department.id, department);
                }
            }

            for (const student of students || []) {
                studentsById.set(student.id, {
                    ...student,
                    department_name: departmentsById.get(student.department_id)?.name || 'N/A'
                });
            }
        }

        if (sessionIds.length > 0) {
            const { data: sessions, error: sessionsError } = await supabase
                .from('sessions')
                .select('id, subject, start_time, end_time')
                .in('id', sessionIds);

            if (sessionsError) {
                return res.status(400).json({ error: sessionsError.message });
            }

            for (const session of sessions || []) {
                sessionsById.set(session.id, session);
            }
        }

        const report = reportRows
            .map((record) => ({
                ...record,
                students: studentsById.get(record.student_id) || null,
                sessions: record.session_id ? sessionsById.get(record.session_id) || null : null
            }))
            .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());

        res.json({ report });
    } catch (error) {
        console.error('Report error:', error);
        res.status(500).json({ error: 'Internal server error while fetching report.' });
    }
});

// A route for manual marking attendance without AI
router.post('/mark', async (req, res) => {
    try {
        const { studentId, sessionId, status = 'Present', period = null, reason = '' } = req.body;

        if (!studentId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const { error: insertError } = await supabase
            .from('attendance')
            .insert([{
                student_id: studentId,
                session_id: sessionId || null,
                status: status,
                period,
                source: 'manual',
                confidence: null,
                review_id: null,
                notes: reason,
                timestamp: new Date().toISOString()
            }]);

        if (insertError) throw insertError;

        return res.json({ message: 'Manual attendance marked successfully', status: 'Success' });
    } catch (error) {
        console.error('Marking error:', error);
        res.status(500).json({ error: 'Internal server error while marking attendance manually.' });
    }
});

router.post('/override', async (req, res) => {
    try {
        const {
            studentId,
            date,
            period,
            status,
            reason = ''
        } = req.body || {};

        if (!studentId || !date || !period || !status) {
            return res.status(400).json({ error: 'studentId, date, period, and status are required.' });
        }

        if (!ALLOWED_OVERRIDE_STATUSES.has(status)) {
            return res.status(400).json({
                error: `Status must be one of: ${Array.from(ALLOWED_OVERRIDE_STATUSES).join(', ')}.`
            });
        }

        const notes = reason?.trim() || (
            status === 'On Duty'
                ? 'Marked as On Duty by admin.'
                : `Attendance status changed to ${status} by admin.`
        );

        const { start, end } = getLocalDateBounds(date);

        const { data: existingAttendance, error: attendanceLookupError } = await supabase
            .from('attendance')
            .select('id')
            .eq('student_id', studentId)
            .eq('period', period)
            .gte('timestamp', start.toISOString())
            .lte('timestamp', end.toISOString())
            .maybeSingle();

        if (attendanceLookupError) {
            throw new Error(attendanceLookupError.message);
        }

        if (existingAttendance?.id) {
            const { error: updateError } = await supabase
                .from('attendance')
                .update({
                    status,
                    source: 'manual_override',
                    confidence: null,
                    review_id: null,
                    notes
                })
                .eq('id', existingAttendance.id);

            if (updateError) {
                throw new Error(updateError.message);
            }
        } else {
            const { error: insertError } = await supabase
                .from('attendance')
                .insert([{
                    student_id: studentId,
                    session_id: null,
                    status,
                    period,
                    source: 'manual_override',
                    confidence: null,
                    review_id: null,
                    notes,
                    timestamp: getPeriodTimestamp(date, period)
                }]);

            if (insertError) {
                throw new Error(insertError.message);
            }
        }

        return res.json({ message: 'Attendance override saved successfully.' });
    } catch (error) {
        console.error('Attendance override error:', error);
        return res.status(500).json({
            error: 'Failed to save attendance override.',
            details: error.message
        });
    }
});

export default router;
