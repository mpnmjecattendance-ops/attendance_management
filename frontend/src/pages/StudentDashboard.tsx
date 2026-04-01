import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
    CalendarDays,
    CheckCircle2,
    Clock3,
    Download,
    Filter,
    LogOut,
    ShieldAlert,
    UserSquare2,
    XCircle
} from 'lucide-react';
import { api } from '../lib/api';
const STUDENT_SESSION_KEY = 'attendance_student_session';

const getTodayDateString = () => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
};

const formatDateForInput = (dateValue: string | Date) => {
    const date = new Date(dateValue);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
};

const statusBadgeClasses: Record<string, string> = {
    Present: 'bg-green-100 text-green-700',
    Absent: 'bg-red-100 text-red-700',
    Late: 'bg-amber-100 text-amber-700',
    Pending: 'bg-gray-100 text-gray-700'
};

type StudentSession = {
    id: string;
    register_number: string;
    name: string;
    dob?: string | null;
    blood_group?: string | null;
    address?: string | null;
    year?: number | string | null;
    semester?: number | string | null;
    parent_phone?: string | null;
    department_name?: string | null;
};

type AttendanceLog = {
    id: string;
    timestamp: string;
    status: string;
    period?: string | null;
    sessions?: {
        subject?: string | null;
    } | null;
};

type DashboardFilters = {
    fromDate: string;
    toDate: string;
    period: string;
    status: string;
};

const defaultFilters: DashboardFilters = {
    fromDate: '',
    toDate: '',
    period: '',
    status: ''
};

const StudentDashboard: React.FC = () => {
    const navigate = useNavigate();
    const [student, setStudent] = useState<StudentSession | null>(null);
    const [report, setReport] = useState<AttendanceLog[]>([]);
    const [filters, setFilters] = useState<DashboardFilters>(defaultFilters);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const storedSession = localStorage.getItem(STUDENT_SESSION_KEY);

        if (!storedSession) {
            navigate('/');
            return;
        }

        const parsedStudent = JSON.parse(storedSession) as StudentSession;
        setStudent(parsedStudent);

        const fetchDashboard = async () => {
            try {
                const [profileRes, reportRes] = await Promise.all([
                    api.get(`/students/${parsedStudent.id}`),
                    api.get(`/attendance/report?studentId=${parsedStudent.id}`)
                ]);

                const latestStudent = profileRes.data.student || parsedStudent;
                const attendanceReport = reportRes.data.report || [];

                setStudent(latestStudent);
                localStorage.setItem(STUDENT_SESSION_KEY, JSON.stringify(latestStudent));
                setReport(attendanceReport);
            } catch (err: any) {
                const backendError = err.response?.data;
                setError(backendError?.error || backendError?.message || 'Failed to load student dashboard');
            } finally {
                setLoading(false);
            }
        };

        fetchDashboard();
    }, [navigate]);

    const filteredReport = useMemo(() => {
        return report.filter((log) => {
            const localDate = formatDateForInput(log.timestamp);
            const sessionLabel = log.period ? log.period.toLowerCase() : 'general';
            const statusLabel = (log.status || '').toLowerCase();

            if (filters.fromDate && localDate < filters.fromDate) {
                return false;
            }

            if (filters.toDate && localDate > filters.toDate) {
                return false;
            }

            if (filters.period && sessionLabel !== filters.period.toLowerCase()) {
                return false;
            }

            if (filters.status && statusLabel !== filters.status.toLowerCase()) {
                return false;
            }

            return true;
        });
    }, [filters, report]);

    const summary = useMemo(() => {
        const present = report.filter((log) => log.status === 'Present').length;
        const absent = report.filter((log) => log.status === 'Absent').length;
        const late = report.filter((log) => log.status === 'Late').length;
        const total = report.length;
        const overallPercentage = total > 0 ? Math.round((present / total) * 100) : 0;
        const neededForSeventyFive = total > 0
            ? Math.max(0, Math.ceil((0.75 * total - present) / 0.25))
            : 0;

        return {
            present,
            absent,
            late,
            total,
            overallPercentage,
            neededForSeventyFive
        };
    }, [report]);

    const todayAttendance = useMemo(() => {
        const today = getTodayDateString();
        const todayRows = report.filter((log) => formatDateForInput(log.timestamp) === today);
        const morning = todayRows.find((log) => (log.period || '').toLowerCase() === 'morning');
        const evening = todayRows.find((log) => (log.period || '').toLowerCase() === 'evening');
        const latest = todayRows[0] || report[0] || null;

        return {
            morningStatus: morning?.status || 'Pending',
            eveningStatus: evening?.status || 'Pending',
            lastMarkedAt: latest?.timestamp || null
        };
    }, [report]);

    const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFilters((prev) => ({ ...prev, [name]: value }));
    };

    const resetFilters = () => {
        setFilters(defaultFilters);
    };

    const exportToExcel = () => {
        if (filteredReport.length === 0) {
            alert('No attendance records available to export.');
            return;
        }

        const exportRows = filteredReport.map((log, index) => ({
            'S.No': index + 1,
            Date: new Date(log.timestamp).toLocaleDateString(),
            Day: new Date(log.timestamp).toLocaleDateString(undefined, { weekday: 'long' }),
            Time: new Date(log.timestamp).toLocaleTimeString(),
            Period: log.period || 'General',
            Session: log.sessions?.subject || 'General',
            Status: log.status
        }));

        const worksheet = XLSX.utils.aoa_to_sheet([]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'My Attendance');

        XLSX.utils.sheet_add_aoa(worksheet, [
            ['Student Attendance Report'],
            ['Student Name', student?.name || 'N/A'],
            ['Register Number', student?.register_number || 'N/A'],
            ['Department', student?.department_name || 'N/A'],
            ['From Date', filters.fromDate || 'All'],
            ['To Date', filters.toDate || 'All'],
            ['Period', filters.period || 'All'],
            ['Status', filters.status || 'All'],
            []
        ], { origin: 'A1' });

        XLSX.utils.sheet_add_json(worksheet, exportRows, { origin: 'A10', skipHeader: false });

        worksheet['!cols'] = [
            { wch: 8 },
            { wch: 14 },
            { wch: 14 },
            { wch: 14 },
            { wch: 12 },
            { wch: 22 },
            { wch: 12 }
        ];

        XLSX.writeFile(workbook, `student-attendance-${student?.register_number || 'report'}.xlsx`);
    };

    const logout = () => {
        localStorage.removeItem(STUDENT_SESSION_KEY);
        navigate('/');
    };

    if (loading) {
        return (
            <div className="max-w-6xl mx-auto bg-white p-6 rounded-xl shadow mt-6">
                <p className="text-gray-500 italic">Loading student dashboard...</p>
            </div>
        );
    }

    if (!student) {
        return null;
    }

    return (
        <div className="max-w-6xl mx-auto mt-6 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border p-6">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div>
                        <h2 className="text-3xl font-bold">Student Dashboard</h2>
                        <p className="text-gray-500 mt-1">Track your attendance, today&apos;s status, and download your report.</p>
                    </div>
                    <button
                        onClick={logout}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white font-semibold hover:bg-black"
                    >
                        <LogOut size={16} /> Logout
                    </button>
                </div>
            </div>

            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <UserSquare2 className="text-blue-600" size={20} />
                        <h3 className="text-xl font-semibold">My Profile</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div className="rounded-lg bg-blue-50 p-4">
                            <p className="text-gray-500">Name</p>
                            <p className="font-semibold text-blue-900">{student.name || 'N/A'}</p>
                        </div>
                        <div className="rounded-lg bg-blue-50 p-4">
                            <p className="text-gray-500">Register Number</p>
                            <p className="font-semibold text-blue-900">{student.register_number || 'N/A'}</p>
                        </div>
                        <div className="rounded-lg bg-blue-50 p-4">
                            <p className="text-gray-500">Department</p>
                            <p className="font-semibold text-blue-900">{student.department_name || 'N/A'}</p>
                        </div>
                        <div className="rounded-lg bg-blue-50 p-4">
                            <p className="text-gray-500">Year / Semester</p>
                            <p className="font-semibold text-blue-900">
                                {student.year || 'N/A'} / {student.semester || 'N/A'}
                            </p>
                        </div>
                        <div className="rounded-lg bg-blue-50 p-4">
                            <p className="text-gray-500">DOB</p>
                            <p className="font-semibold text-blue-900">{student.dob || 'N/A'}</p>
                        </div>
                        <div className="rounded-lg bg-blue-50 p-4">
                            <p className="text-gray-500">Blood Group</p>
                            <p className="font-semibold text-blue-900">{student.blood_group || 'N/A'}</p>
                        </div>
                        <div className="rounded-lg bg-blue-50 p-4 md:col-span-2">
                            <p className="text-gray-500">Address</p>
                            <p className="font-semibold text-blue-900">{student.address || 'N/A'}</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <CalendarDays className="text-emerald-600" size={20} />
                        <h3 className="text-xl font-semibold">Today Status</h3>
                    </div>

                    <div className="space-y-3">
                        <div className="rounded-lg border p-4">
                            <p className="text-sm text-gray-500 mb-1">Morning</p>
                            <span className={`inline-flex px-3 py-1 rounded-full text-sm font-semibold ${statusBadgeClasses[todayAttendance.morningStatus] || statusBadgeClasses.Pending}`}>
                                {todayAttendance.morningStatus}
                            </span>
                        </div>

                        <div className="rounded-lg border p-4">
                            <p className="text-sm text-gray-500 mb-1">Evening</p>
                            <span className={`inline-flex px-3 py-1 rounded-full text-sm font-semibold ${statusBadgeClasses[todayAttendance.eveningStatus] || statusBadgeClasses.Pending}`}>
                                {todayAttendance.eveningStatus}
                            </span>
                        </div>

                        <div className="rounded-lg border p-4">
                            <p className="text-sm text-gray-500 mb-1">Last Marked</p>
                            <p className="font-semibold text-gray-800">
                                {todayAttendance.lastMarkedAt
                                    ? `${new Date(todayAttendance.lastMarkedAt).toLocaleDateString()} ${new Date(todayAttendance.lastMarkedAt).toLocaleTimeString()}`
                                    : 'No attendance marked yet'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                <div className="bg-white rounded-2xl shadow-sm border p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <CheckCircle2 className="text-green-600" size={20} />
                        <p className="text-sm text-gray-500">Present</p>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{summary.present}</p>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <XCircle className="text-red-600" size={20} />
                        <p className="text-sm text-gray-500">Absent</p>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{summary.absent}</p>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <Clock3 className="text-amber-600" size={20} />
                        <p className="text-sm text-gray-500">Late</p>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{summary.late}</p>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <CalendarDays className="text-blue-600" size={20} />
                        <p className="text-sm text-gray-500">Overall %</p>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{summary.overallPercentage}%</p>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <ShieldAlert className="text-violet-600" size={20} />
                        <p className="text-sm text-gray-500">75% Target</p>
                    </div>
                    <p className="text-lg font-bold text-gray-900">
                        {summary.neededForSeventyFive > 0 ? `${summary.neededForSeventyFive} more present needed` : 'Safe'}
                    </p>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border p-6">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-5">
                    <div className="flex items-center gap-2">
                        <Filter className="text-purple-600" size={18} />
                        <h3 className="text-xl font-semibold">Attendance Filters</h3>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={resetFilters}
                            className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200"
                        >
                            Reset Filters
                        </button>
                        <button
                            type="button"
                            onClick={exportToExcel}
                            disabled={filteredReport.length === 0}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
                        >
                            <Download size={16} /> Export Excel
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
                        <input
                            name="fromDate"
                            type="date"
                            value={filters.fromDate}
                            onChange={handleFilterChange}
                            className="w-full border rounded-lg px-3 py-2"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
                        <input
                            name="toDate"
                            type="date"
                            value={filters.toDate}
                            onChange={handleFilterChange}
                            className="w-full border rounded-lg px-3 py-2"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
                        <select
                            name="period"
                            value={filters.period}
                            onChange={handleFilterChange}
                            className="w-full border rounded-lg px-3 py-2"
                        >
                            <option value="">All Periods</option>
                            <option value="Morning">Morning</option>
                            <option value="Evening">Evening</option>
                            <option value="General">General</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                        <select
                            name="status"
                            value={filters.status}
                            onChange={handleFilterChange}
                            className="w-full border rounded-lg px-3 py-2"
                        >
                            <option value="">All Status</option>
                            <option value="Present">Present</option>
                            <option value="Absent">Absent</option>
                            <option value="Late">Late</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <div className="px-6 py-4 border-b">
                    <h3 className="text-xl font-semibold">My Attendance Log</h3>
                    <p className="text-sm text-gray-500 mt-1">Showing {filteredReport.length} records</p>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="p-4 font-semibold text-gray-600">Date</th>
                                <th className="p-4 font-semibold text-gray-600">Day</th>
                                <th className="p-4 font-semibold text-gray-600">Period / Session</th>
                                <th className="p-4 font-semibold text-gray-600">Marked Time</th>
                                <th className="p-4 font-semibold text-gray-600">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredReport.length > 0 ? filteredReport.map((log) => (
                                <tr key={log.id} className="border-b hover:bg-gray-50">
                                    <td className="p-4">{new Date(log.timestamp).toLocaleDateString()}</td>
                                    <td className="p-4 text-gray-600">
                                        {new Date(log.timestamp).toLocaleDateString(undefined, { weekday: 'long' })}
                                    </td>
                                    <td className="p-4 text-gray-600">{log.sessions?.subject || log.period || 'General'}</td>
                                    <td className="p-4 text-gray-600">{new Date(log.timestamp).toLocaleTimeString()}</td>
                                    <td className="p-4">
                                        <span className={`inline-flex px-3 py-1 rounded-full text-sm font-semibold ${statusBadgeClasses[log.status] || statusBadgeClasses.Pending}`}>
                                            {log.status}
                                        </span>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={5} className="p-6 text-center text-gray-500">
                                        No attendance records match the selected filters.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default StudentDashboard;
