import express from 'express';
import { getAttendanceSettings, upsertAttendanceSettings } from '../services/attendanceSettingsService.js';
import { syncAbsencesForToday } from '../services/attendanceSyncService.js';
import { addHoliday, deleteHoliday, getHolidays } from '../services/calendarService.js';

const router = express.Router();

router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

router.get('/attendance', async (req, res) => {
    try {
        const settings = await getAttendanceSettings();
        res.json({ settings });
    } catch (error) {
        console.error('Attendance settings fetch error:', error);
        res.status(500).json({
            error: 'Failed to fetch attendance settings.',
            details: error.message
        });
    }
});

router.put('/attendance', async (req, res) => {
    try {
        const settings = await upsertAttendanceSettings(req.body || {});
        res.json({ message: 'Attendance settings updated successfully.', settings });
    } catch (error) {
        console.error('Attendance settings update error:', error);
        res.status(500).json({
            error: 'Failed to update attendance settings.',
            details: error.message
        });
    }
});

router.post('/attendance/sync-absences', async (req, res) => {
    try {
        const result = await syncAbsencesForToday();
        res.json({
            message: 'Absence sync completed.',
            ...result
        });
    } catch (error) {
        console.error('Attendance sync error:', error);
        res.status(500).json({
            error: 'Failed to sync absences.',
            details: error.message
        });
    }
});

router.get('/holidays', async (req, res) => {
    try {
        const holidays = await getHolidays({
            fromDate: req.query.fromDate,
            toDate: req.query.toDate
        });

        res.json({ holidays });
    } catch (error) {
        console.error('Holiday fetch error:', error);
        res.status(500).json({
            error: 'Failed to fetch holidays.',
            details: error.message
        });
    }
});

router.post('/holidays', async (req, res) => {
    try {
        const { date, reason, is_holiday = true } = req.body || {};

        if (!date) {
            return res.status(400).json({ error: 'Holiday date is required.' });
        }

        const holiday = await addHoliday({
            date,
            reason: reason || 'Holiday',
            isHoliday: is_holiday
        });

        res.json({ message: 'Holiday saved successfully.', holiday });
    } catch (error) {
        console.error('Holiday save error:', error);
        res.status(500).json({
            error: 'Failed to save holiday.',
            details: error.message
        });
    }
});

router.delete('/holidays/:holidayId', async (req, res) => {
    try {
        await deleteHoliday(req.params.holidayId);
        res.json({ message: 'Holiday removed successfully.' });
    } catch (error) {
        console.error('Holiday delete error:', error);
        res.status(500).json({
            error: 'Failed to delete holiday.',
            details: error.message
        });
    }
});

export default router;
