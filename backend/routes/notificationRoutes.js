import express from 'express';
import twilio from 'twilio';
import { supabase } from '../utils/supabaseClient.js';
import dotenv from 'dotenv';
import { getLocalDateBounds } from '../services/attendanceSettingsService.js';

dotenv.config();

const router = express.Router();

const hasTwilioConfig = Boolean(
    process.env.TWILIO_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
);
const twilioClient = hasTwilioConfig ? twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN) : null;
const ALLOW_MOCK_NOTIFICATIONS = String(process.env.ALLOW_MOCK_NOTIFICATIONS || '').toLowerCase() === 'true';
const DEFAULT_COUNTRY_CODE = process.env.NOTIFICATION_COUNTRY_CODE || '+91';

const TAMIL_TODAY = '\u0b87\u0ba9\u0bcd\u0bb1\u0bc1';
const TAMIL_PLEASE_CHECK = '\u0ba4\u0baf\u0bb5\u0bc1\u0b9a\u0bc6\u0baf\u0bcd\u0ba4\u0bc1 \u0b95\u0bb5\u0ba9\u0bbf\u0b95\u0bcd\u0b95\u0bb5\u0bc1\u0bae\u0bcd.';
const PERIOD_LABELS = {
    morning: {
        english: ' during the morning session',
        tamil: ' \u0b95\u0bbe\u0bb2\u0bc8 \u0b85\u0bae\u0bb0\u0bcd\u0bb5\u0bbf\u0bb2\u0bcd'
    },
    evening: {
        english: ' during the evening session',
        tamil: ' \u0bae\u0bbe\u0bb2\u0bc8 \u0b85\u0bae\u0bb0\u0bcd\u0bb5\u0bbf\u0bb2\u0bcd'
    },
    default: {
        english: '',
        tamil: ''
    }
};

const normalizePhoneNumber = (phoneNumber) => {
    if (!phoneNumber) {
        return null;
    }

    const sanitized = String(phoneNumber).replace(/[^\d+]/g, '');

    if (sanitized.startsWith('+') && sanitized.length >= 11) {
        return sanitized;
    }

    const digitsOnly = sanitized.replace(/\D/g, '');

    if (digitsOnly.length === 10) {
        return `${DEFAULT_COUNTRY_CODE}${digitsOnly}`;
    }

    if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
        return `${DEFAULT_COUNTRY_CODE}${digitsOnly.slice(1)}`;
    }

    if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
        return `+${digitsOnly}`;
    }

    return null;
};

const formatMessageDate = (value, locale, fallback) => {
    if (!value) {
        return fallback;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return fallback;
    }

    return new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    }).format(parsed);
};

const getPeriodLabel = (period = '') => PERIOD_LABELS[String(period).trim().toLowerCase()] || PERIOD_LABELS.default;

const buildSmsMessage = ({
    studentName,
    status = 'Absent',
    period = '',
    attendanceDate = null
}) => {
    const normalizedStatus = String(status || 'Absent').trim().toLowerCase();
    const periodLabel = getPeriodLabel(period);
    const englishDate = formatMessageDate(attendanceDate, 'en-IN', 'today');
    const tamilDate = formatMessageDate(attendanceDate, 'ta-IN', TAMIL_TODAY);

    if (normalizedStatus === 'late') {
        return [
            `${studentName} was marked late on ${englishDate}${periodLabel.english}. Please check.`,
            `${studentName} ${tamilDate}${periodLabel.tamil} \u0ba4\u0bbe\u0bae\u0ba4\u0bae\u0bbe\u0b95 \u0bb5\u0ba8\u0bcd\u0ba4\u0bc1\u0bb3\u0bcd\u0bb3\u0bbe\u0bb0\u0bcd. ${TAMIL_PLEASE_CHECK}`
        ].join('\n');
    }

    if (normalizedStatus === 'present') {
        return [
            `${studentName} was marked present on ${englishDate}${periodLabel.english}.`,
            `${studentName} ${tamilDate}${periodLabel.tamil} \u0bb5\u0bb0\u0bc1\u0b95\u0bc8\u0baf\u0bbe\u0b95 \u0baa\u0ba4\u0bbf\u0bb5\u0bc1 \u0b9a\u0bc6\u0baf\u0bcd\u0baf\u0baa\u0bcd\u0baa\u0b9f\u0bcd\u0b9f\u0bc1\u0bb3\u0bcd\u0bb3\u0bbe\u0bb0\u0bcd.`
        ].join('\n');
    }

    return [
        `${studentName} was absent on ${englishDate}${periodLabel.english}. Please check.`,
        `${studentName} ${tamilDate}${periodLabel.tamil} \u0bb5\u0bb0\u0bb5\u0bbf\u0bb2\u0bcd\u0bb2\u0bc8. ${TAMIL_PLEASE_CHECK}`
    ].join('\n');
};

router.post('/send', async (req, res) => {
    try {
        const {
            studentId,
            message,
            type = 'SMS',
            status = 'Absent',
            period = '',
            attendanceDate = null
        } = req.body || {};

        if (!studentId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const { data: student, error: studentError } = await supabase
            .from('students')
            .select('parent_phone, name')
            .eq('id', studentId)
            .single();

        if (studentError || !student) {
            return res.status(404).json({ error: 'Student not found.' });
        }

        const normalizedPhoneNumber = normalizePhoneNumber(student.parent_phone);

        if (type === 'SMS' && !normalizedPhoneNumber) {
            return res.status(400).json({
                error: 'Invalid parent phone number.',
                details: `Stored number '${student.parent_phone}' could not be converted to E.164 format.`
            });
        }

        const messageBody = String(message || '').trim() || buildSmsMessage({
            studentName: student.name,
            status,
            period,
            attendanceDate
        });

        const { start: startOfDay } = getLocalDateBounds();

        const { data: recentNotifs } = await supabase
            .from('notifications')
            .select('*')
            .eq('student_id', studentId)
            .eq('type', type)
            .eq('status', 'Sent')
            .gte('timestamp', startOfDay.toISOString());

        if (recentNotifs && recentNotifs.length > 0) {
            return res.json({
                message: 'Notification already sent today for this student.',
                status: 'AlreadySent'
            });
        }

        let sendStatus = 'Failed';
        let responseMessage = '';
        let responseStatus = '';

        if (type === 'SMS' && !twilioClient) {
            if (!ALLOW_MOCK_NOTIFICATIONS) {
                return res.status(503).json({
                    error: 'SMS provider is not configured.',
                    details: 'Set TWILIO_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER, or enable ALLOW_MOCK_NOTIFICATIONS=true for local testing.'
                });
            }

            sendStatus = 'Sent';
            responseStatus = 'MockSent';
            responseMessage = 'Mock SMS alert recorded successfully. No real SMS was sent.';
            console.log(`[MOCK NOTIFICATION] Sent ${type} to ${normalizedPhoneNumber || student.parent_phone}: ${messageBody}`);
        } else if (type === 'SMS' && twilioClient) {
            try {
                await twilioClient.messages.create({
                    body: messageBody,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: normalizedPhoneNumber
                });
                sendStatus = 'Sent';
                responseStatus = 'Sent';
                responseMessage = 'Notification sent successfully';
            } catch (twilioError) {
                await supabase
                    .from('notifications')
                    .insert([{
                        student_id: studentId,
                        type,
                        status: sendStatus,
                        message: messageBody,
                        timestamp: new Date().toISOString()
                    }]);

                return res.status(twilioError.status || 502).json({
                    error: 'Failed to send SMS via Twilio.',
                    details: twilioError.message
                });
            }
        } else {
            return res.status(400).json({
                error: `Notification type '${type}' is not supported by this route.`
            });
        }

        const { error: insertError } = await supabase
            .from('notifications')
            .insert([{
                student_id: studentId,
                type,
                status: sendStatus,
                message: messageBody,
                timestamp: new Date().toISOString()
            }]);

        if (insertError) {
            return res.status(500).json({
                error: 'Notification was sent, but logging it failed.',
                details: insertError.message
            });
        }

        return res.json({ message: responseMessage, status: responseStatus || sendStatus });
    } catch (error) {
        console.error('Notification error:', error);
        res.status(500).json({
            error: 'Internal server error while sending notification.',
            details: error.message
        });
    }
});

export default router;
