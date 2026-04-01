import { supabase } from '../utils/supabaseClient.js';
import { getStoragePublicUrl } from './storageService.js';

export const REVIEW_STATUS = {
    PENDING: 'Pending',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    EXPIRED: 'Expired'
};

export const expireStaleReviews = async (expiryMinutes = 90) => {
    const expiryCutoff = new Date(Date.now() - (expiryMinutes * 60 * 1000)).toISOString();

    const { error } = await supabase
        .from('recognition_reviews')
        .update({ status: REVIEW_STATUS.EXPIRED })
        .eq('status', REVIEW_STATUS.PENDING)
        .lt('created_at', expiryCutoff);

    if (error) {
        const isMissingTable = error.message?.includes('recognition_reviews');
        if (isMissingTable) {
            return;
        }
        throw new Error(error.message);
    }
};

export const getPendingReviews = async ({ expiryMinutes = 90 } = {}) => {
    await expireStaleReviews(expiryMinutes);

    const { data, error } = await supabase
        .from('recognition_reviews')
        .select('*')
        .eq('status', REVIEW_STATUS.PENDING)
        .order('created_at', { ascending: false });

    if (error) {
        const isMissingTable = error.message?.includes('recognition_reviews');
        if (isMissingTable) {
            return [];
        }
        throw new Error(error.message);
    }

    const reviews = data || [];

    const candidateIds = [...new Set(reviews.map((review) => review.candidate_student_id).filter(Boolean))];
    const studentsById = new Map();

    if (candidateIds.length > 0) {
        const { data: students } = await supabase
            .from('students')
            .select('id, name, register_number')
            .in('id', candidateIds);

        for (const student of students || []) {
            studentsById.set(student.id, student);
        }
    }

    return reviews.map((review) => ({
        ...review,
        image_url: getStoragePublicUrl(review.bucket_name, review.image_path),
        candidate_student: studentsById.get(review.candidate_student_id) || null
    }));
};

export const findOpenReviewForStudent = async ({ studentId, period, fromTimestamp }) => {
    const { data, error } = await supabase
        .from('recognition_reviews')
        .select('id')
        .eq('candidate_student_id', studentId)
        .eq('period', period)
        .eq('status', REVIEW_STATUS.PENDING)
        .gte('created_at', fromTimestamp)
        .maybeSingle();

    if (error) {
        const isMissingTable = error.message?.includes('recognition_reviews');
        if (isMissingTable) {
            return null;
        }
        throw new Error(error.message);
    }

    return data || null;
};
