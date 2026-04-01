import express from 'express';
import { supabase } from '../utils/supabaseClient.js';
import { getPendingReviews, REVIEW_STATUS } from '../services/reviewService.js';

const router = express.Router();

const getReviewDayBounds = (timestamp) => {
    const date = new Date(timestamp);
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    return { start, end };
};

const resolveAttendanceTimestamp = (review) => {
    const date = new Date(review.created_at);

    if ((review.period || '').toLowerCase() === 'morning') {
        date.setHours(9, 0, 0, 0);
        return date.toISOString();
    }

    if ((review.period || '').toLowerCase() === 'evening') {
        date.setHours(16, 0, 0, 0);
        return date.toISOString();
    }

    return review.created_at;
};

const finalizeReviewApproval = async ({ review, resolvedStudentId, status, reviewer = 'admin' }) => {
    const { start, end } = getReviewDayBounds(review.created_at);
    const { data: existingAttendance, error: attendanceLookupError } = await supabase
        .from('attendance')
        .select('id')
        .eq('student_id', resolvedStudentId)
        .eq('period', review.period)
        .gte('timestamp', start.toISOString())
        .lte('timestamp', end.toISOString())
        .maybeSingle();

    if (attendanceLookupError) {
        throw new Error(attendanceLookupError.message);
    }

    if (!existingAttendance) {
        const { error: attendanceInsertError } = await supabase
            .from('attendance')
            .insert([{
                student_id: resolvedStudentId,
                session_id: null,
                status: 'Present',
                period: review.period,
                timestamp: resolveAttendanceTimestamp(review),
                source: 'review_approved',
                confidence: review.confidence,
                review_id: review.id
            }]);

        if (attendanceInsertError) {
            throw new Error(attendanceInsertError.message);
        }
    }

    const { error: reviewUpdateError } = await supabase
        .from('recognition_reviews')
        .update({
            status,
            resolved_student_id: resolvedStudentId,
            reviewed_by: reviewer,
            reviewed_at: new Date().toISOString()
        })
        .eq('id', review.id);

    if (reviewUpdateError) {
        throw new Error(reviewUpdateError.message);
    }
};

router.get('/pending', async (req, res) => {
    try {
        const expiryMinutes = Number(req.query.expiryMinutes || 0) || undefined;
        const reviews = await getPendingReviews({ expiryMinutes });
        return res.json({ reviews });
    } catch (error) {
        console.error('Pending review fetch error:', error);
        return res.status(500).json({
            error: 'Failed to fetch pending reviews.',
            details: error.message
        });
    }
});

router.post('/:reviewId/approve', async (req, res) => {
    try {
        const { reviewId } = req.params;
        const { studentId, reviewer = 'admin' } = req.body || {};

        const { data: review, error } = await supabase
            .from('recognition_reviews')
            .select('*')
            .eq('id', reviewId)
            .maybeSingle();

        if (error || !review) {
            return res.status(404).json({ error: 'Review item not found.' });
        }

        const resolvedStudentId = studentId || review.candidate_student_id;

        if (!resolvedStudentId) {
            return res.status(400).json({ error: 'A student must be selected to approve this review.' });
        }

        await finalizeReviewApproval({
            review,
            resolvedStudentId,
            status: REVIEW_STATUS.APPROVED,
            reviewer
        });

        return res.json({ message: 'Review approved and attendance marked present.' });
    } catch (error) {
        console.error('Review approve error:', error);
        return res.status(500).json({
            error: 'Failed to approve recognition review.',
            details: error.message
        });
    }
});

router.post('/:reviewId/reject', async (req, res) => {
    try {
        const { reviewId } = req.params;
        const { reviewer = 'admin' } = req.body || {};

        const { error } = await supabase
            .from('recognition_reviews')
            .update({
                status: REVIEW_STATUS.REJECTED,
                reviewed_by: reviewer,
                reviewed_at: new Date().toISOString()
            })
            .eq('id', reviewId);

        if (error) {
            throw new Error(error.message);
        }

        return res.json({ message: 'Review rejected successfully.' });
    } catch (error) {
        console.error('Review reject error:', error);
        return res.status(500).json({
            error: 'Failed to reject recognition review.',
            details: error.message
        });
    }
});

router.post('/:reviewId/assign', async (req, res) => {
    try {
        const { reviewId } = req.params;
        const { studentId, reviewer = 'admin' } = req.body || {};

        if (!studentId) {
            return res.status(400).json({ error: 'studentId is required to assign a review.' });
        }

        const { data: review, error } = await supabase
            .from('recognition_reviews')
            .select('*')
            .eq('id', reviewId)
            .maybeSingle();

        if (error || !review) {
            return res.status(404).json({ error: 'Review item not found.' });
        }

        await finalizeReviewApproval({
            review,
            resolvedStudentId: studentId,
            status: REVIEW_STATUS.APPROVED,
            reviewer
        });

        return res.json({ message: 'Review assigned and attendance marked present.' });
    } catch (error) {
        console.error('Review assign error:', error);
        return res.status(500).json({
            error: 'Failed to assign recognition review.',
            details: error.message
        });
    }
});

export default router;
