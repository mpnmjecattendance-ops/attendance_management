import express from 'express';
import { supabase } from '../utils/supabaseClient.js';
import { formatLocalDate } from '../services/attendanceSettingsService.js';
import { syncAbsencesForToday } from '../services/attendanceSyncService.js';

const router = express.Router();

const getPeriodTimestamp = (date, period) => {
    const timestamp = new Date(`${date}T12:00:00`);

    if ((period || '').toLowerCase() === 'morning') {
        timestamp.setHours(9, 0, 0, 0);
        return timestamp.toISOString();
    }

    if ((period || '').toLowerCase() === 'evening') {
        timestamp.setHours(16, 0, 0, 0);
        return timestamp.toISOString();
    }

    return timestamp.toISOString();
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
        const today = formatLocalDate();
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
        const hasStudentFilters = Boolean(studentId || departmentId || parsedYear || parsedSemester);

        if (hasStudentFilters) {
            let studentQuery = supabase
                .from('students')
                .select('id');

            if (studentId) {
                studentQuery = studentQuery.eq('id', studentId);
            }

            if (departmentId) {
                studentQuery = studentQuery.eq('department_id', departmentId);
            }

            if (parsedYear) {
                studentQuery = studentQuery.eq('year', parsedYear);
            }

            if (parsedSemester) {
                studentQuery = studentQuery.eq('semester', parsedSemester);
            }

            const { data: matchingStudents, error: studentFilterError } = await studentQuery;

            if (studentFilterError) {
                return res.status(400).json({ error: studentFilterError.message });
            }

            filteredStudentIds = (matchingStudents || []).map((student) => student.id);

            if (filteredStudentIds.length === 0) {
                return res.json({ report: [] });
            }
        }

        let query = supabase
            .from('attendance')
            .select('*')
            .order('timestamp', { ascending: false });

        if (filteredStudentIds) {
            query = query.in('student_id', filteredStudentIds);
        }

        if (normalizedFromDate) {
            const start = new Date(`${normalizedFromDate}T00:00:00`);
            query = query.gte('timestamp', start.toISOString());
        }

        if (normalizedToDate) {
            const end = new Date(`${normalizedToDate}T23:59:59.999`);
            query = query
                .lte('timestamp', end.toISOString());
        }

        const { data: attendanceRecords, error } = await query;

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        const studentIds = [...new Set((attendanceRecords || []).map((record) => record.student_id).filter(Boolean))];
        const sessionIds = [...new Set((attendanceRecords || []).map((record) => record.session_id).filter(Boolean))];
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

        const report = (attendanceRecords || []).map((record) => ({
            ...record,
            students: studentsById.get(record.student_id) || null,
            sessions: record.session_id ? sessionsById.get(record.session_id) || null : null
        }));

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

        const start = new Date(`${date}T00:00:00`).toISOString();
        const end = new Date(`${date}T23:59:59.999`).toISOString();

        const { data: existingAttendance, error: attendanceLookupError } = await supabase
            .from('attendance')
            .select('id')
            .eq('student_id', studentId)
            .eq('period', period)
            .gte('timestamp', start)
            .lte('timestamp', end)
            .maybeSingle();

        if (attendanceLookupError) {
            throw new Error(attendanceLookupError.message);
        }

        if (existingAttendance?.id) {
            const { error: updateError } = await supabase
                .from('attendance')
                .update({
                    status,
                    source: 'manual',
                    confidence: null,
                    review_id: null,
                    notes: reason
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
                    source: 'manual',
                    confidence: null,
                    review_id: null,
                    notes: reason,
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
