import { supabase } from '../utils/supabaseClient.js';
import {
    createLocalTimestamp,
    formatLocalDate,
    getLocalDayOfWeek,
    getAttendanceSettings,
    getCompletedAttendancePeriods,
    getLocalDateBounds
} from './attendanceSettingsService.js';
import { isHoliday } from './calendarService.js';
import { expireStaleReviews, REVIEW_STATUS } from './reviewService.js';

export const syncAbsencesForToday = async (now = new Date()) => {
    if (getLocalDayOfWeek(now) === 0) {
        return { inserted: 0, processedPeriods: [], date: formatLocalDate(now), message: "It's Sunday - no attendance sync today." };
    }

    const settings = await getAttendanceSettings();
    await expireStaleReviews(settings.review_expiry_minutes);

    const holidayInfo = await isHoliday(now);

    if (holidayInfo.isHoliday) {
        return {
            inserted: 0,
            processedPeriods: [],
            date: formatLocalDate(now),
            message: `Attendance sync skipped for holiday: ${holidayInfo.reason || 'Holiday'}`
        };
    }

    if (!settings.auto_mark_absent) {
        return { inserted: 0, processedPeriods: [], date: formatLocalDate(now) };
    }

    const completedPeriods = getCompletedAttendancePeriods(settings, now);

    if (completedPeriods.length === 0) {
        return { inserted: 0, processedPeriods: [], date: formatLocalDate(now) };
    }

    const { start, end } = getLocalDateBounds(now);

    let students = [];
    let studentsError = null;

    const activeStudentsResult = await supabase
        .from('students')
        .select('id')
        .eq('is_active', true);

    if (activeStudentsResult.error?.message?.includes('is_active')) {
        const fallbackStudentsResult = await supabase
            .from('students')
            .select('id');
        students = fallbackStudentsResult.data || [];
        studentsError = fallbackStudentsResult.error;
    } else {
        students = activeStudentsResult.data || [];
        studentsError = activeStudentsResult.error;
    }

    if (studentsError) {
        throw new Error(studentsError.message);
    }

    let inserted = 0;
    const currentDate = formatLocalDate(now);

    for (const period of completedPeriods) {
        const { data: existingAttendance, error: attendanceError } = await supabase
            .from('attendance')
            .select('student_id')
            .eq('period', period)
            .gte('timestamp', start.toISOString())
            .lte('timestamp', end.toISOString());

        if (attendanceError) {
            const isMissingPeriodColumn = attendanceError.message?.includes('period');
            if (isMissingPeriodColumn) {
                throw new Error('Supabase is missing the attendance period column. Run the SQL update first.');
            }
            throw new Error(attendanceError.message);
        }

        const alreadyMarked = new Set((existingAttendance || []).map((record) => record.student_id));
        const { data: pendingReviews, error: pendingReviewsError } = await supabase
            .from('recognition_reviews')
            .select('candidate_student_id')
            .eq('period', period)
            .eq('status', REVIEW_STATUS.PENDING)
            .gte('created_at', start.toISOString())
            .lte('created_at', end.toISOString());

        if (pendingReviewsError && !pendingReviewsError.message?.includes('recognition_reviews')) {
            throw new Error(pendingReviewsError.message);
        }

        const reviewBlockedStudents = new Set((pendingReviews || []).map((review) => review.candidate_student_id).filter(Boolean));
        const missingStudents = (students || [])
            .filter((student) => !alreadyMarked.has(student.id))
            .filter((student) => !reviewBlockedStudents.has(student.id))
            .map((student) => ({
                student_id: student.id,
                session_id: null,
                status: 'Absent',
                period,
                source: 'auto_absent',
                timestamp: createLocalTimestamp(currentDate, period === 'Morning' ? '09:00:00' : '16:00:00')
            }));

        if (missingStudents.length === 0) {
            continue;
        }

        const { error: insertError } = await supabase
            .from('attendance')
            .insert(missingStudents);

        if (insertError) {
            const isMissingPeriodColumn = insertError.message?.includes('period');
            if (isMissingPeriodColumn) {
                throw new Error('Supabase is missing the attendance period column. Run the SQL update first.');
            }
            throw new Error(insertError.message);
        }

        inserted += missingStudents.length;
    }

    return {
        inserted,
        processedPeriods: completedPeriods,
        date: formatLocalDate(now)
    };
};
