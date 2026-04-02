import express from 'express';
import twilio from 'twilio'; // Ensure this is installed
import { supabase } from '../utils/supabaseClient.js';
import dotenv from 'dotenv';
import { getLocalDateBounds } from '../services/attendanceSettingsService.js';
dotenv.config();

const router = express.Router();

// Twilio setup
const hasTwilioConfig = Boolean(
    process.env.TWILIO_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
);
const twilioClient = hasTwilioConfig ? twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN) : null;
const ALLOW_MOCK_NOTIFICATIONS = String(process.env.ALLOW_MOCK_NOTIFICATIONS || '').toLowerCase() === 'true';
const DEFAULT_COUNTRY_CODE = process.env.NOTIFICATION_COUNTRY_CODE || '+91';

const buildFallbackSmsMessage = (studentName) => [
    `Attendance Alert: ${studentName} is absent for college today. Please check.`,
    `வருகை எச்சரிக்கை: ${studentName} இன்று கல்லூரிக்கு வரவில்லை. தயவுசெய்து கவனிக்கவும்.`
].join('\n');

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

router.post('/send', async (req, res) => {
    try {
        const { studentId, message, type = 'SMS' } = req.body;

        if (!studentId || !message) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Fetch parent phone
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

        // Duplicate prevention logic (e.g., check if notification already sent today)
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
            console.log(`[MOCK NOTIFICATION] Sent ${type} to ${normalizedPhoneNumber || student.parent_phone}: ${message}`);
        } else if (type === 'SMS' && twilioClient) {
            try {
                await twilioClient.messages.create({
                    body: message || buildFallbackSmsMessage(student.name),
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
                        message: message,
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

        // Log notification
        const { error: insertError } = await supabase
            .from('notifications')
            .insert([{
                student_id: studentId,
                type,
                status: sendStatus,
                message: message,
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
