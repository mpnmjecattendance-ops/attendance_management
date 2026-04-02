import { supabase } from '../utils/supabaseClient.js';

export const DEFAULT_ATTENDANCE_SETTINGS = {
    id: 1,
    morning_start: '08:30:00',
    morning_end: '10:00:00',
    evening_start: '15:30:00',
    evening_end: '17:00:00',
    auto_mark_absent: true,
    auto_accept_threshold: 0.72,
    review_threshold: 0.58,
    consensus_frames: 3,
    cooldown_seconds: 20,
    review_expiry_minutes: 90
};

export const ATTENDANCE_PERIODS = [
    { period: 'Morning', startField: 'morning_start', endField: 'morning_end' },
    { period: 'Evening', startField: 'evening_start', endField: 'evening_end' }
];

export const normalizeTimeValue = (value, fallback = '00:00:00') => {
    if (!value) {
        return fallback;
    }

    const stringValue = String(value).trim();

    if (/^\d{2}:\d{2}$/.test(stringValue)) {
        return `${stringValue}:00`;
    }

    if (/^\d{2}:\d{2}:\d{2}$/.test(stringValue)) {
        return stringValue;
    }

    return fallback;
};

export const formatTimeLabel = (value) => normalizeTimeValue(value).slice(0, 5);

export const toMinutes = (value) => {
    const normalized = normalizeTimeValue(value);
    const [hours, minutes] = normalized.split(':').map(Number);
    return (hours * 60) + minutes;
};

export const formatLocalDate = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export const getLocalDateBounds = (dateInput = new Date()) => {
    const date = dateInput instanceof Date
        ? new Date(dateInput)
        : new Date(`${dateInput}T00:00:00`);

    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    return { start, end };
};

export const hydrateAttendanceSettings = (row = {}) => ({
    ...DEFAULT_ATTENDANCE_SETTINGS,
    ...row,
    morning_start: normalizeTimeValue(row.morning_start, DEFAULT_ATTENDANCE_SETTINGS.morning_start),
    morning_end: normalizeTimeValue(row.morning_end, DEFAULT_ATTENDANCE_SETTINGS.morning_end),
    evening_start: normalizeTimeValue(row.evening_start, DEFAULT_ATTENDANCE_SETTINGS.evening_start),
    evening_end: normalizeTimeValue(row.evening_end, DEFAULT_ATTENDANCE_SETTINGS.evening_end),
    auto_mark_absent: row.auto_mark_absent ?? DEFAULT_ATTENDANCE_SETTINGS.auto_mark_absent,
    auto_accept_threshold: Number(row.auto_accept_threshold ?? DEFAULT_ATTENDANCE_SETTINGS.auto_accept_threshold),
    review_threshold: Number(row.review_threshold ?? DEFAULT_ATTENDANCE_SETTINGS.review_threshold),
    consensus_frames: Number(row.consensus_frames ?? DEFAULT_ATTENDANCE_SETTINGS.consensus_frames),
    cooldown_seconds: Number(row.cooldown_seconds ?? DEFAULT_ATTENDANCE_SETTINGS.cooldown_seconds),
    review_expiry_minutes: Number(row.review_expiry_minutes ?? DEFAULT_ATTENDANCE_SETTINGS.review_expiry_minutes)
});

const ensureFiniteNumber = (value, fieldName) => {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        throw new Error(`${fieldName} must be a valid number.`);
    }

    return parsed;
};

const ensureIntegerInRange = (value, fieldName, min, max) => {
    const parsed = ensureFiniteNumber(value, fieldName);

    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`${fieldName} must be an integer between ${min} and ${max}.`);
    }

    return parsed;
};

const ensureDecimalInRange = (value, fieldName, min, max) => {
    const parsed = ensureFiniteNumber(value, fieldName);

    if (parsed < min || parsed > max) {
        throw new Error(`${fieldName} must be between ${min} and ${max}.`);
    }

    return parsed;
};

const validateAttendanceSettings = (settings) => {
    for (const { period, startField, endField } of ATTENDANCE_PERIODS) {
        if (toMinutes(settings[startField]) >= toMinutes(settings[endField])) {
            throw new Error(`${period} start time must be earlier than ${period} end time.`);
        }
    }

    if (toMinutes(settings.morning_end) > toMinutes(settings.evening_start)) {
        throw new Error('Morning attendance must end before the evening window starts.');
    }

    settings.auto_accept_threshold = ensureDecimalInRange(settings.auto_accept_threshold, 'Auto-accept threshold', 0, 1);
    settings.review_threshold = ensureDecimalInRange(settings.review_threshold, 'Review threshold', 0, 1);

    if (settings.review_threshold >= settings.auto_accept_threshold) {
        throw new Error('Review threshold must be lower than the auto-accept threshold.');
    }

    settings.consensus_frames = ensureIntegerInRange(settings.consensus_frames, 'Consensus frames', 1, 10);
    settings.cooldown_seconds = ensureIntegerInRange(settings.cooldown_seconds, 'Cooldown seconds', 1, 300);
    settings.review_expiry_minutes = ensureIntegerInRange(settings.review_expiry_minutes, 'Review expiry minutes', 1, 1440);

    return settings;
};

let settingsCache = {
    data: null,
    timestamp: 0
};
const CACHE_TTL = 300 * 1000; // 5 minutes

export const getAttendanceSettings = async () => {
    const now = Date.now();
    if (settingsCache.data && (now - settingsCache.timestamp) < CACHE_TTL) {
        return settingsCache.data;
    }

    const { data, error } = await supabase
        .from('attendance_settings')
        .select('*')
        .eq('id', DEFAULT_ATTENDANCE_SETTINGS.id)
        .maybeSingle();

    if (error) {
        const isMissingTable = error.message?.includes('attendance_settings');
        if (isMissingTable || error.message?.includes('fetch failed')) {
            return settingsCache.data || DEFAULT_ATTENDANCE_SETTINGS;
        }
        throw new Error(error.message);
    }

    const result = data ? hydrateAttendanceSettings(data) : DEFAULT_ATTENDANCE_SETTINGS;
    
    settingsCache = {
        data: result,
        timestamp: now
    };

    return result;
};

export const upsertAttendanceSettings = async (payload) => {
    const normalizedPayload = validateAttendanceSettings(hydrateAttendanceSettings({
        ...payload,
        id: DEFAULT_ATTENDANCE_SETTINGS.id
    }));

    const { data, error } = await supabase
        .from('attendance_settings')
        .upsert(normalizedPayload, { onConflict: 'id' })
        .select()
        .single();

    if (error) {
        const isMissingTable = error.message?.includes('attendance_settings');
        if (isMissingTable) {
            throw new Error('Supabase is missing the attendance_settings table. Run the SQL update first.');
        }
        throw new Error(error.message);
    }

    const result = hydrateAttendanceSettings(data);
    settingsCache = {
        data: result,
        timestamp: Date.now()
    };

    return result;
};

export const getAttendanceWindow = (settings, now = new Date()) => {
    const currentMinutes = (now.getHours() * 60) + now.getMinutes();

    for (const { period, startField, endField } of ATTENDANCE_PERIODS) {
        const startMinutes = toMinutes(settings[startField]);
        const endMinutes = toMinutes(settings[endField]);

        if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
            return {
                period,
                start: settings[startField],
                end: settings[endField]
            };
        }
    }

    return null;
};

export const getCompletedAttendancePeriods = (settings, now = new Date()) => {
    const currentMinutes = (now.getHours() * 60) + now.getMinutes();

    return ATTENDANCE_PERIODS
        .filter(({ endField }) => currentMinutes > toMinutes(settings[endField]))
        .map(({ period }) => period);
};
