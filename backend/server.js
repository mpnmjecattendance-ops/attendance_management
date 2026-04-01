import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';

// Load env variables
dotenv.config();

import authRoutes from './routes/authRoutes.js';
import studentRoutes from './routes/studentRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import reviewRoutes from './routes/reviewRoutes.js';
import { syncAbsencesForToday } from './services/attendanceSyncService.js';

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error('CORS origin not allowed'));
    }
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('dev'));

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/students', studentRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/recognize', aiRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/reviews', reviewRoutes);

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        message: 'Backend is running',
        aiServiceConfigured: Boolean(process.env.AI_SERVICE_URL || process.env.AI_URL),
        corsOrigins: allowedOrigins
    });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Keep absence rows in sync while the backend is running.
setInterval(() => {
    syncAbsencesForToday().catch((error) => {
        console.error('Scheduled absence sync failed:', error.message);
    });
}, 60 * 1000);

syncAbsencesForToday().catch((error) => {
    console.error('Initial absence sync failed:', error.message);
});
