import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { CalendarDays, Clock3, Plus, Save, Trash2, ShieldCheck } from 'lucide-react';

type AttendanceSettings = {
    morning_start: string;
    morning_end: string;
    evening_start: string;
    evening_end: string;
    auto_mark_absent: boolean;
    auto_accept_threshold: number;
    review_threshold: number;
    consensus_frames: number;
    cooldown_seconds: number;
    review_expiry_minutes: number;
};

type HolidayItem = {
    id: string;
    date: string;
    reason: string;
    is_holiday: boolean;
};

const defaultSettings: AttendanceSettings = {
    morning_start: '08:30',
    morning_end: '10:00',
    evening_start: '15:30',
    evening_end: '17:00',
    auto_mark_absent: true,
    auto_accept_threshold: 0.72,
    review_threshold: 0.58,
    consensus_frames: 3,
    cooldown_seconds: 20,
    review_expiry_minutes: 90
};

const getTodayDateString = () => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
};

const sortHolidays = (items: HolidayItem[]) => [...items].sort((left, right) => left.date.localeCompare(right.date));

const upsertHoliday = (items: HolidayItem[], nextHoliday: HolidayItem) => sortHolidays([
    ...items.filter((holiday) => holiday.id !== nextHoliday.id && holiday.date !== nextHoliday.date),
    nextHoliday
]);

const mapIncomingSettings = (incoming: Partial<AttendanceSettings> & {
    morning_start?: string;
    morning_end?: string;
    evening_start?: string;
    evening_end?: string;
}) => ({
    morning_start: incoming.morning_start?.slice(0, 5) || defaultSettings.morning_start,
    morning_end: incoming.morning_end?.slice(0, 5) || defaultSettings.morning_end,
    evening_start: incoming.evening_start?.slice(0, 5) || defaultSettings.evening_start,
    evening_end: incoming.evening_end?.slice(0, 5) || defaultSettings.evening_end,
    auto_mark_absent: Boolean(incoming.auto_mark_absent),
    auto_accept_threshold: Number(incoming.auto_accept_threshold ?? defaultSettings.auto_accept_threshold),
    review_threshold: Number(incoming.review_threshold ?? defaultSettings.review_threshold),
    consensus_frames: Number(incoming.consensus_frames ?? defaultSettings.consensus_frames),
    cooldown_seconds: Number(incoming.cooldown_seconds ?? defaultSettings.cooldown_seconds),
    review_expiry_minutes: Number(incoming.review_expiry_minutes ?? defaultSettings.review_expiry_minutes)
});

const AdminSettings: React.FC = () => {
    const [settings, setSettings] = useState<AttendanceSettings>(defaultSettings);
    const [holidays, setHolidays] = useState<HolidayItem[]>([]);
    const [holidayForm, setHolidayForm] = useState({
        date: getTodayDateString(),
        reason: 'College Holiday'
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [holidayLoading, setHolidayLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [holidayStatus, setHolidayStatus] = useState('');

    const recognitionHealth = useMemo(() => {
        if (settings.review_threshold >= settings.auto_accept_threshold) {
            return 'Review threshold should stay lower than auto-accept threshold.';
        }

        if (settings.consensus_frames < 1) {
            return 'Consensus frames must be at least 1.';
        }

        return '';
    }, [settings]);

    const scheduleHealth = useMemo(() => {
        if (settings.morning_start >= settings.morning_end) {
            return 'Morning start time must be earlier than morning end time.';
        }

        if (settings.evening_start >= settings.evening_end) {
            return 'Evening start time must be earlier than evening end time.';
        }

        if (settings.morning_end > settings.evening_start) {
            return 'Morning attendance should end before the evening window begins.';
        }

        return '';
    }, [settings]);

    useEffect(() => {
        const loadPage = async () => {
            setLoading(true);
            try {
                await Promise.all([fetchSettings(), fetchHolidays()]);
            } finally {
                setLoading(false);
            }
        };

        loadPage();
    }, []);

    const fetchSettings = async () => {
        try {
            const res = await api.get('/settings/attendance');
            setSettings(mapIncomingSettings(res.data.settings || {}));
        } catch (error: any) {
            const backendError = error.response?.data;
            setStatus([backendError?.error, backendError?.details].filter(Boolean).join(' - ') || 'Failed to load attendance settings.');
        }
    };

    const fetchHolidays = async () => {
        try {
            const res = await api.get('/settings/holidays');
            setHolidays(sortHolidays(res.data.holidays || []));
        } catch (error: any) {
            const backendError = error.response?.data;
            setHolidayStatus([backendError?.error, backendError?.details].filter(Boolean).join(' - ') || 'Failed to load holidays.');
        }
    };

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = event.target;
        setSettings((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        } as AttendanceSettings));
    };

    const handleHolidayChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = event.target;
        setHolidayForm((prev) => ({ ...prev, [name]: value }));
    };

    const saveSettings = async () => {
        setSaving(true);
        setStatus('');

        if (scheduleHealth || recognitionHealth) {
            setStatus(scheduleHealth || recognitionHealth);
            setSaving(false);
            return;
        }

        try {
            const payload = {
                ...settings,
                auto_accept_threshold: Number(settings.auto_accept_threshold),
                review_threshold: Number(settings.review_threshold),
                consensus_frames: Number(settings.consensus_frames),
                cooldown_seconds: Number(settings.cooldown_seconds),
                review_expiry_minutes: Number(settings.review_expiry_minutes)
            };
            const res = await api.put('/settings/attendance', payload);
            if (res.data.settings) {
                setSettings(mapIncomingSettings(res.data.settings));
            }
            setStatus(res.data.message || 'Attendance settings saved successfully.');
        } catch (error: any) {
            const backendError = error.response?.data;
            setStatus([backendError?.error, backendError?.details].filter(Boolean).join(' - ') || 'Failed to save attendance settings.');
        } finally {
            setSaving(false);
        }
    };

    const saveHoliday = async () => {
        if (!holidayForm.date) {
            setHolidayStatus('Holiday date is required.');
            return;
        }

        setHolidayLoading(true);
        setHolidayStatus('');

        try {
            const res = await api.post('/settings/holidays', {
                date: holidayForm.date,
                reason: holidayForm.reason || 'College Holiday',
                is_holiday: true
            });
            setHolidayStatus(res.data.message || 'Holiday saved successfully.');
            if (res.data.holiday) {
                setHolidays((prev) => upsertHoliday(prev, res.data.holiday));
            } else {
                await fetchHolidays();
            }
        } catch (error: any) {
            const backendError = error.response?.data;
            setHolidayStatus([backendError?.error, backendError?.details].filter(Boolean).join(' - ') || 'Failed to save holiday.');
        } finally {
            setHolidayLoading(false);
        }
    };

    const removeHoliday = async (holidayId: string) => {
        setHolidayLoading(true);
        setHolidayStatus('');
        try {
            const res = await api.delete(`/settings/holidays/${holidayId}`);
            setHolidayStatus(res.data.message || 'Holiday removed successfully.');
            setHolidays((prev) => prev.filter((holiday) => holiday.id !== holidayId));
        } catch (error: any) {
            const backendError = error.response?.data;
            setHolidayStatus([backendError?.error, backendError?.details].filter(Boolean).join(' - ') || 'Failed to delete holiday.');
        } finally {
            setHolidayLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="max-w-6xl mx-auto bg-white p-6 rounded-xl shadow border">
                <p className="text-gray-500 italic">Loading attendance settings...</p>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <div className="bg-gradient-to-r from-blue-700 via-cyan-600 to-emerald-500 p-6 text-white">
                    <h2 className="text-3xl font-bold flex items-center gap-3">
                        <Clock3 /> Attendance Settings
                    </h2>
                    <p className="mt-2 text-blue-50 max-w-3xl">
                        Configure attendance windows, review thresholds, and holiday dates so morning and evening marking behaves like a real daily campus system.
                    </p>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5 space-y-4">
                            <h3 className="text-lg font-bold text-blue-950">Attendance Windows</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-blue-950 mb-2">Morning Start</label>
                                    <input type="time" name="morning_start" value={settings.morning_start} onChange={handleChange} className="w-full rounded-lg border px-3 py-2" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-blue-950 mb-2">Morning End</label>
                                    <input type="time" name="morning_end" value={settings.morning_end} onChange={handleChange} className="w-full rounded-lg border px-3 py-2" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-blue-950 mb-2">Evening Start</label>
                                    <input type="time" name="evening_start" value={settings.evening_start} onChange={handleChange} className="w-full rounded-lg border px-3 py-2" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-blue-950 mb-2">Evening End</label>
                                    <input type="time" name="evening_end" value={settings.evening_end} onChange={handleChange} className="w-full rounded-lg border px-3 py-2" />
                                </div>
                            </div>

                            <label className="flex items-center gap-3 rounded-xl border border-blue-100 bg-white px-4 py-3">
                                <input
                                    type="checkbox"
                                    name="auto_mark_absent"
                                    checked={settings.auto_mark_absent}
                                    onChange={handleChange}
                                    className="h-4 w-4"
                                />
                                <span className="font-medium text-gray-700">Auto-mark absent after a window closes</span>
                            </label>
                        </div>

                        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5 space-y-4">
                            <div className="flex items-start gap-3">
                                <ShieldCheck className="text-emerald-700 mt-1" />
                                <div>
                                    <h3 className="text-lg font-bold text-emerald-950">Recognition Controls</h3>
                                    <p className="text-sm text-emerald-900/70 mt-1">
                                        Strong matches auto-mark present. Borderline matches go to admin review instead of silently failing.
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-emerald-950 mb-2">Auto Accept Threshold</label>
                                    <input type="number" step="0.01" min="0" max="1" name="auto_accept_threshold" value={settings.auto_accept_threshold} onChange={handleChange} className="w-full rounded-lg border px-3 py-2" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-emerald-950 mb-2">Review Threshold</label>
                                    <input type="number" step="0.01" min="0" max="1" name="review_threshold" value={settings.review_threshold} onChange={handleChange} className="w-full rounded-lg border px-3 py-2" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-emerald-950 mb-2">Consensus Frames</label>
                                    <input type="number" min="1" max="10" name="consensus_frames" value={settings.consensus_frames} onChange={handleChange} className="w-full rounded-lg border px-3 py-2" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-emerald-950 mb-2">Cooldown Seconds</label>
                                    <input type="number" min="1" max="300" name="cooldown_seconds" value={settings.cooldown_seconds} onChange={handleChange} className="w-full rounded-lg border px-3 py-2" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-emerald-950 mb-2">Review Expiry Minutes</label>
                                    <input type="number" min="1" max="1440" name="review_expiry_minutes" value={settings.review_expiry_minutes} onChange={handleChange} className="w-full rounded-lg border px-3 py-2" />
                                </div>
                            </div>

                            {(scheduleHealth || recognitionHealth) && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                    {scheduleHealth || recognitionHealth}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                        <button
                            onClick={saveSettings}
                            disabled={saving}
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            <Save size={16} /> {saving ? 'Saving...' : 'Save Settings'}
                        </button>
                    </div>

                    {status && (
                        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                            {status}
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <div className="p-6 border-b bg-slate-50 flex items-center gap-3">
                    <CalendarDays className="text-violet-600" />
                    <div>
                        <h3 className="text-xl font-bold text-slate-900">Holiday Calendar</h3>
                        <p className="text-sm text-slate-500">Attendance sync will skip Sundays and any date you mark as a holiday here.</p>
                    </div>
                </div>

                <div className="p-6 grid grid-cols-1 xl:grid-cols-[360px,1fr] gap-6">
                    <div className="rounded-2xl border border-violet-100 bg-violet-50 p-5 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-violet-950 mb-2">Holiday Date</label>
                            <input type="date" name="date" value={holidayForm.date} onChange={handleHolidayChange} className="w-full rounded-lg border px-3 py-2" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-violet-950 mb-2">Reason</label>
                            <input type="text" name="reason" value={holidayForm.reason} onChange={handleHolidayChange} className="w-full rounded-lg border px-3 py-2" placeholder="Ex: Founders Day" />
                        </div>
                        <button
                            type="button"
                            onClick={saveHoliday}
                            disabled={holidayLoading}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                        >
                            <Plus size={16} /> {holidayLoading ? 'Saving...' : 'Save Holiday'}
                        </button>
                        {holidayStatus && (
                            <div className="rounded-xl border border-violet-100 bg-white px-4 py-3 text-sm text-slate-700">
                                {holidayStatus}
                            </div>
                        )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 border-b">
                                    <tr>
                                        <th className="px-4 py-3 text-sm font-semibold text-slate-600">Date</th>
                                        <th className="px-4 py-3 text-sm font-semibold text-slate-600">Reason</th>
                                        <th className="px-4 py-3 text-sm font-semibold text-slate-600">Status</th>
                                        <th className="px-4 py-3 text-sm font-semibold text-slate-600 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {holidays.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-400 italic">
                                                No holidays saved yet.
                                            </td>
                                        </tr>
                                    ) : (
                                        holidays.map((holiday) => (
                                            <tr key={holiday.id} className="border-b last:border-b-0">
                                                <td className="px-4 py-3 font-medium text-slate-900">{holiday.date}</td>
                                                <td className="px-4 py-3 text-slate-600">{holiday.reason || 'Holiday'}</td>
                                                <td className="px-4 py-3">
                                                    <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
                                                        {holiday.is_holiday ? 'Skipped for attendance' : 'Open'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => removeHoliday(holiday.id)}
                                                        disabled={holidayLoading}
                                                        className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                                                    >
                                                        <Trash2 size={14} /> Remove
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminSettings;

