import express from 'express';
import { recognizeFace } from '../services/aiService.js';
import { supabase } from '../utils/supabaseClient.js';
import {
    formatTimeLabel,
    getAttendanceSettings,
    getAttendanceWindow,
    getLocalDateBounds
} from '../services/attendanceSettingsService.js';
import { isHoliday } from '../services/calendarService.js';
import { uploadReviewImage } from '../services/storageService.js';
import { findOpenReviewForStudent, REVIEW_STATUS } from '../services/reviewService.js';

const router = express.Router();
const REJECTION_STATUS_MAP = {
    multiple_faces: 'MultipleFaces',
    no_face: 'NoFace',
    low_brightness: 'TooDark',
    low_sharpness: 'TooBlurry',
    face_too_small: 'MoveCloser',
    face_not_in_guide: 'CenterFace',
    face_not_centered: 'CenterFace',
    invalid_frame: 'FrameRetry'
};

const CONSENSUS_WINDOW_MS = 5 * 1000;
const terminalConsensus = new Map();
const terminalCooldowns = new Map();
const terminalProcessing = new Set();

const pruneRecognitionState = (nowMs = Date.now()) => {
    for (const [terminalId, state] of terminalConsensus.entries()) {
        if (nowMs - state.lastSeenAt > CONSENSUS_WINDOW_MS) {
            terminalConsensus.delete(terminalId);
        }
    }

    for (const [key, cooldownUntil] of terminalCooldowns.entries()) {
        if (cooldownUntil <= nowMs) {
            terminalCooldowns.delete(key);
        }
    }
};

const clearTerminalConsensus = (terminalId) => {
    terminalConsensus.delete(terminalId);
};

const resolveValidatedSessionId = async (sessionId) => {
    if (!sessionId) {
        return null;
    }

    const { data: session, error } = await supabase
        .from('sessions')
        .select('id')
        .eq('id', sessionId)
        .maybeSingle();

    if (error) {
        throw new Error(error.message);
    }

    return session?.id || null;
};

const getAttendanceDayBounds = (timestamp = new Date()) => {
    const { start, end } = getLocalDateBounds(timestamp);
    return {
        startIso: start.toISOString(),
        endIso: end.toISOString()
    };
};

const findExistingAttendance = async ({ studentId, period, startIso, endIso }) => {
    const { data, error } = await supabase
        .from('attendance')
        .select('id')
        .eq('student_id', studentId)
        .eq('period', period)
        .gte('timestamp', startIso)
        .lte('timestamp', endIso)
        .maybeSingle();

    if (error) {
        throw new Error(error.message);
    }

    return data || null;
};

const createReviewRecord = async ({
    imageBase64,
    terminalId,
    period,
    candidateStudentId,
    confidence
}) => {
    let bucketName = null;
    let imagePath = null;

    try {
        const upload = await uploadReviewImage({
            terminalId,
            period,
            base64Image: imageBase64
        });

        bucketName = upload?.bucketName || null;
        imagePath = upload?.imagePath || null;
    } catch (uploadError) {
        console.error('Review image upload skipped:', uploadError.message);
    }

    const { data, error } = await supabase
        .from('recognition_reviews')
        .insert([{
            bucket_name: bucketName,
            image_path: imagePath,
            terminal_id: terminalId,
            period,
            candidate_student_id: candidateStudentId,
            confidence,
            status: REVIEW_STATUS.PENDING
        }])
        .select('id')
        .single();

    if (error) {
        throw new Error(error.message);
    }

    return data?.id || null;
};

router.post('/', async (req, res) => {
    const {
        imageBase64,
        sessionId,
        terminalId = 'campus-gate-1',
        enforceGuide = false
    } = req.body || {};

    if (terminalProcessing.has(terminalId)) {
        return res.status(202).json({
            message: 'Processing another frame from this terminal...',
            status: 'Busy'
        });
    }

    try {
        terminalProcessing.add(terminalId);
        pruneRecognitionState();

        if (!imageBase64) {
            return res.status(400).json({ error: 'Image is required.' });
        }

        if (new Date().getDay() === 0) {
            clearTerminalConsensus(terminalId);
            return res.json({
                message: 'Attendance cannot be marked on Sundays.',
                status: 'Blocked',
                reason: 'Sunday'
            });
        }

        const holidayInfo = await isHoliday(new Date());

        if (holidayInfo.isHoliday) {
            clearTerminalConsensus(terminalId);
            return res.json({
                message: `Attendance is blocked today because it is marked as ${holidayInfo.reason || 'a holiday'}.`,
                status: 'Blocked',
                reason: 'Holiday'
            });
        }

        const settings = await getAttendanceSettings();
        const activeAttendanceWindow = getAttendanceWindow(settings);

        if (!activeAttendanceWindow) {
            clearTerminalConsensus(terminalId);
            return res.json({
                message: `Attendance is only marked during Morning (${formatTimeLabel(settings.morning_start)}-${formatTimeLabel(settings.morning_end)}) and Evening (${formatTimeLabel(settings.evening_start)}-${formatTimeLabel(settings.evening_end)}).`,
                status: 'Blocked',
                reason: 'OutsideWindow'
            });
        }

        const validatedSessionId = await resolveValidatedSessionId(sessionId);
        const aiResponse = await recognizeFace(imageBase64, terminalId, enforceGuide);
        const forceReview = aiResponse.status === 'ambiguous';

        if ((aiResponse.status !== 'recognized' && !forceReview) || !aiResponse.student_id) {
            clearTerminalConsensus(terminalId);
            return res.json({
                message: aiResponse.message || 'Face not recognized',
                status: REJECTION_STATUS_MAP[aiResponse.status] || 'Unknown',
                details: aiResponse.reason || null
            });
        }

        const confidence = Number(aiResponse.confidence || 0);

        if (!forceReview && confidence < settings.review_threshold) {
            clearTerminalConsensus(terminalId);
            return res.json({
                message: 'Not recognized with enough confidence.',
                status: 'Unknown',
                confidence
            });
        }

        const nowMs = Date.now();
        const candidateKey = `${aiResponse.student_id}:${activeAttendanceWindow.period}`;
        const existingConsensus = terminalConsensus.get(terminalId);

        const nextConsensus = !existingConsensus ||
            existingConsensus.candidateKey !== candidateKey ||
            nowMs - existingConsensus.startedAt > CONSENSUS_WINDOW_MS ||
            nowMs - existingConsensus.lastSeenAt > CONSENSUS_WINDOW_MS
            ? {
                candidateKey,
                studentId: aiResponse.student_id,
                studentName: aiResponse.name,
                period: activeAttendanceWindow.period,
                confidence,
                frames: 1,
                startedAt: nowMs,
                lastSeenAt: nowMs
            }
            : {
                ...existingConsensus,
                confidence: Math.max(existingConsensus.confidence, confidence),
                forceReview: existingConsensus.forceReview || forceReview,
                frames: existingConsensus.frames + 1,
                lastSeenAt: nowMs
            };

        if (!existingConsensus ||
            existingConsensus.candidateKey !== candidateKey ||
            nowMs - existingConsensus.startedAt > CONSENSUS_WINDOW_MS ||
            nowMs - existingConsensus.lastSeenAt > CONSENSUS_WINDOW_MS) {
            nextConsensus.forceReview = forceReview;
        }

        terminalConsensus.set(terminalId, nextConsensus);

        if (nextConsensus.frames < settings.consensus_frames) {
            return res.status(202).json({
                message: `Hold steady for confirmation (${nextConsensus.frames}/${settings.consensus_frames})`,
                student: aiResponse.name,
                confidence,
                status: 'Pending'
            });
        }

        clearTerminalConsensus(terminalId);

        const cooldownKey = `${terminalId}:${candidateKey}`;
        const cooldownUntil = terminalCooldowns.get(cooldownKey) || 0;

        if (cooldownUntil > nowMs) {
            return res.json({
                message: `${activeAttendanceWindow.period} recognition was already processed recently for this terminal.`,
                student: aiResponse.name,
                confidence,
                status: 'Duplicate'
            });
        }

        const { startIso, endIso } = getAttendanceDayBounds();
        const existingAttendance = await findExistingAttendance({
            studentId: aiResponse.student_id,
            period: activeAttendanceWindow.period,
            startIso,
            endIso
        });

        terminalCooldowns.set(cooldownKey, nowMs + (settings.cooldown_seconds * 1000));

        if (existingAttendance) {
            return res.json({
                message: `${activeAttendanceWindow.period} attendance already marked for today.`,
                student: aiResponse.name,
                confidence,
                status: 'Duplicate'
            });
        }

        if (!nextConsensus.forceReview && confidence >= settings.auto_accept_threshold) {
            const { error: insertError } = await supabase
                .from('attendance')
                .insert([{
                    student_id: aiResponse.student_id,
                    session_id: validatedSessionId,
                    status: 'Present',
                    period: activeAttendanceWindow.period,
                    source: 'face_auto',
                    confidence,
                    timestamp: new Date().toISOString()
                }]);

            if (insertError) {
                throw new Error(insertError.message);
            }

            return res.json({
                message: `${activeAttendanceWindow.period} attendance marked successfully.`,
                student: aiResponse.name,
                confidence,
                status: 'Success'
            });
        }

        const existingReview = await findOpenReviewForStudent({
            studentId: aiResponse.student_id,
            period: activeAttendanceWindow.period,
            fromTimestamp: startIso
        });

        const reviewId = existingReview?.id || await createReviewRecord({
            imageBase64,
            terminalId,
            period: activeAttendanceWindow.period,
            candidateStudentId: aiResponse.student_id,
            confidence
        });

        return res.json({
            message: nextConsensus.forceReview
                ? `${activeAttendanceWindow.period} recognition is too close to another student and was sent for admin review.`
                : `${activeAttendanceWindow.period} recognition was sent for admin review.`,
            student: aiResponse.name,
            confidence,
            reviewId,
            status: 'ReviewRequired'
        });
    } catch (error) {
        console.error('Recognition error:', error);
        return res.status(500).json({
            error: 'Recognition request failed',
            details: error.message
        });
    } finally {
        terminalProcessing.delete(terminalId);
    }
});

export default router;
