import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calendar, CheckCircle, Download, Filter, PhoneCall, RefreshCcw, SearchCheck, ShieldAlert, UserCheck, XCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../lib/api';

const YEAR_OPTIONS = ['1', '2', '3', '4'];
const SEMESTER_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8'];

const getTodayDateString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const defaultFilters = {
  departmentId: '',
  year: '',
  semester: '',
  fromDate: getTodayDateString(),
  toDate: getTodayDateString()
};

const getPeriodMessage = (period: string) => {
  const normalized = (period || '').toLowerCase();
  if (normalized === 'morning') return { english: ' during the morning session', tamil: ' ???? ?????????' };
  if (normalized === 'evening') return { english: ' during the evening session', tamil: ' ???? ?????????' };
  return { english: '', tamil: '' };
};

const buildParentAlertMessage = (studentName: string, status: string, period: string) => {
  const periodMessage = getPeriodMessage(period);
  if (status.toLowerCase() === 'absent') {
    return [
      `Attendance Alert: ${studentName} is absent for college today${periodMessage.english}. Please check.`,
      `????? ??????????: ${studentName} ????? ??????????? ????????${periodMessage.tamil}. ?????????? ???????????.`
    ].join('\n');
  }

  return [
    `Attendance Alert: ${studentName} is marked ${status.toLowerCase()} for college today${periodMessage.english}. Please check.`,
    `????? ??????????: ${studentName} ????? ??????????? ${status === 'Late' ? '??????? ???????????' : '????? ???????? ??????? ??????'}${periodMessage.tamil}. ?????????? ???????????.`
  ].join('\n');
};

const formatSource = (source?: string | null) => !source ? 'Legacy' : source.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
const formatConfidence = (value?: number | null) => value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : `${(Number(value) * 100).toFixed(1)}%`;
const getExportFileName = (filters: typeof defaultFilters) => `attendance-report-${filters.fromDate || 'all'}-to-${filters.toDate || 'all'}.xlsx`;

const AdminReports: React.FC = () => {
  const [attendanceData, setAttendanceData] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [reviewAssignments, setReviewAssignments] = useState<Record<string, string>>({});
  const [stats, setStats] = useState({ present: 0, absent: 0, late: 0, total: 0, pendingReviews: 0 });
  const [loading, setLoading] = useState(true);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const selectedDepartmentName = useMemo(
    () => departments.find((department: any) => department.id === filters.departmentId)?.name || 'All Departments',
    [departments, filters.departmentId]
  );

  const updateStats = (data: any[], pendingReviewsCount = reviews.length) => {
    const present = data.filter((record) => record.status === 'Present').length;
    const absent = data.filter((record) => record.status === 'Absent').length;
    const late = data.filter((record) => record.status === 'Late').length;
    setStats({ present, absent, late, total: data.length, pendingReviews: pendingReviewsCount });
  };

  const buildReportParams = (activeFilters: typeof defaultFilters) => {
    const params = new URLSearchParams();
    if (activeFilters.departmentId) params.append('departmentId', activeFilters.departmentId);
    if (activeFilters.year) params.append('year', activeFilters.year);
    if (activeFilters.semester) params.append('semester', activeFilters.semester);
    if (activeFilters.fromDate) params.append('fromDate', activeFilters.fromDate);
    if (activeFilters.toDate) params.append('toDate', activeFilters.toDate);
    return params.toString();
  };

  const fetchDepartments = async () => {
    const res = await api.get('/students/departments');
    setDepartments(res.data.departments || []);
  };

  const fetchStudents = async () => {
    const res = await api.get('/students?activeOnly=true');
    setStudents(res.data.students || []);
  };

  const fetchReports = async (activeFilters = filters) => {
    setReportsLoading(true);
    try {
      setError('');
      const queryString = buildReportParams(activeFilters);
      const res = await api.get(`/attendance/report${queryString ? `?${queryString}` : ''}`);
      const data = res.data.report || [];
      setAttendanceData(data);
      updateStats(data, reviews.length);
    } catch (err: any) {
      const backendError = err.response?.data;
      setAttendanceData([]);
      updateStats([], reviews.length);
      setError([backendError?.error, backendError?.details, backendError?.message].filter(Boolean).join(' - ') || 'Failed to load reports.');
    } finally {
      setReportsLoading(false);
    }
  };

  const fetchPendingReviews = async () => {
    try {
      const res = await api.get('/reviews/pending');
      const nextReviews = res.data.reviews || [];
      setReviews(nextReviews);
      setReviewAssignments((prev) => {
        const nextAssignments = { ...prev };
        nextReviews.forEach((review: any) => { nextAssignments[review.id] = nextAssignments[review.id] || review.candidate_student_id || ''; });
        return nextAssignments;
      });
      updateStats(attendanceData, nextReviews.length);
    } catch (err: any) {
      const backendError = err.response?.data;
      setStatus([backendError?.error, backendError?.details].filter(Boolean).join(' - ') || 'Failed to load pending reviews.');
    }
  };

  const refreshReportsAndReviews = async () => {
    await Promise.all([fetchReports(filters), fetchPendingReviews()]);
  };

  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      try {
        await Promise.all([fetchDepartments(), fetchStudents(), fetchReports(defaultFilters), fetchPendingReviews()]);
      } finally {
        setLoading(false);
      }
    };
    loadInitialData();
  }, []);

  const handleFilterChange = (event: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    const { name, value } = event.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const sendAlert = async (record: any) => {
    const studentName = record.students?.name || 'Student';
    if (record.status === 'Present') {
      alert(`${studentName} is marked present. No parent alert is needed.`);
      return;
    }

    setActionKey(`alert-${record.id}`);
    setStatus('');
    try {
      const res = await api.post('/notifications/send', {
        studentId: record.student_id,
        message: buildParentAlertMessage(studentName, record.status, record.period || 'attendance'),
        type: 'SMS'
      });
      alert(res.data?.message || `SMS alert sent to parent of ${studentName}.`);
    } catch (err: any) {
      const backendError = err.response?.data;
      alert([backendError?.message, backendError?.error, backendError?.details].filter(Boolean).join(' - ') || 'Failed to send alert.');
    } finally {
      setActionKey(null);
    }
  };

  const overrideAttendance = async (record: any, nextStatus: 'Present' | 'Absent' | 'Late') => {
    if (!record.period) {
      alert('This record does not have a morning/evening period yet, so it cannot be overridden safely.');
      return;
    }

    const reason = window.prompt(`Reason for setting ${record.students?.name || 'this student'} to ${nextStatus}:`, record.notes || '');
    if (reason === null) return;

    setActionKey(`override-${record.id}-${nextStatus}`);
    setStatus('');
    try {
      const date = new Date(record.timestamp).toISOString().slice(0, 10);
      const res = await api.post('/attendance/override', { studentId: record.student_id, date, period: record.period, status: nextStatus, reason });
      setStatus(res.data?.message || 'Attendance override saved successfully.');
      await fetchReports(filters);
    } catch (err: any) {
      const backendError = err.response?.data;
      setStatus([backendError?.error, backendError?.details].filter(Boolean).join(' - ') || 'Failed to save attendance override.');
    } finally {
      setActionKey(null);
    }
  };

  const approveReview = async (review: any) => {
    setActionKey(`review-approve-${review.id}`);
    setStatus('');
    try {
      const res = await api.post(`/reviews/${review.id}/approve`, { studentId: reviewAssignments[review.id] || review.candidate_student_id || undefined, reviewer: 'admin-dashboard' });
      setStatus(res.data?.message || 'Review approved.');
      await refreshReportsAndReviews();
    } catch (err: any) {
      const backendError = err.response?.data;
      setStatus([backendError?.error, backendError?.details].filter(Boolean).join(' - ') || 'Failed to approve review.');
    } finally {
      setActionKey(null);
    }
  };

  const rejectReview = async (reviewId: string) => {
    setActionKey(`review-reject-${reviewId}`);
    setStatus('');
    try {
      const res = await api.post(`/reviews/${reviewId}/reject`, { reviewer: 'admin-dashboard' });
      setStatus(res.data?.message || 'Review rejected.');
      await refreshReportsAndReviews();
    } catch (err: any) {
      const backendError = err.response?.data;
      setStatus([backendError?.error, backendError?.details].filter(Boolean).join(' - ') || 'Failed to reject review.');
    } finally {
      setActionKey(null);
    }
  };

  const assignReview = async (reviewId: string) => {
    const studentId = reviewAssignments[reviewId];
    if (!studentId) {
      alert('Choose a student before assigning this review.');
      return;
    }

    setActionKey(`review-assign-${reviewId}`);
    setStatus('');
    try {
      const res = await api.post(`/reviews/${reviewId}/assign`, { studentId, reviewer: 'admin-dashboard' });
      setStatus(res.data?.message || 'Review assigned successfully.');
      await refreshReportsAndReviews();
    } catch (err: any) {
      const backendError = err.response?.data;
      setStatus([backendError?.error, backendError?.details].filter(Boolean).join(' - ') || 'Failed to assign review.');
    } finally {
      setActionKey(null);
    }
  };

  const exportToExcel = () => {
    if (attendanceData.length === 0) {
      alert('No attendance data available to export.');
      return;
    }

    const rows = attendanceData.map((record, index) => ({
      'S.No': index + 1,
      'Student Name': record.students?.name || 'N/A',
      'Register No': record.students?.register_number || 'N/A',
      Department: record.students?.department_name || 'N/A',
      Year: record.students?.year || 'N/A',
      Semester: record.students?.semester || 'N/A',
      Date: new Date(record.timestamp).toLocaleDateString(),
      Time: new Date(record.timestamp).toLocaleTimeString(),
      Period: record.period || record.sessions?.subject || 'General',
      Status: record.status || 'N/A',
      Source: formatSource(record.source),
      Confidence: formatConfidence(record.confidence),
      Notes: record.notes || ''
    }));

    const worksheet = XLSX.utils.aoa_to_sheet([]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance Report');
    XLSX.utils.sheet_add_aoa(worksheet, [
      ['Attendance Report'],
      ['Department', selectedDepartmentName],
      ['Year', filters.year || 'All'],
      ['Semester', filters.semester || 'All'],
      ['From Date', filters.fromDate || 'All'],
      ['To Date', filters.toDate || 'All'],
      ['Pending Reviews', reviews.length],
      []
    ], { origin: 'A1' });
    XLSX.utils.sheet_add_json(worksheet, rows, { origin: 'A9', skipHeader: false });
    XLSX.writeFile(workbook, getExportFileName(filters));
  };

  return (
    <div className="container mx-auto p-4 max-w-7xl space-y-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold flex items-center gap-2"><Calendar className="text-blue-600" /> Attendance Reports & Review Console</h2>
        <p className="text-gray-500">Filter attendance, export clean reports, review borderline scans, and apply manual corrections without leaving the dashboard.</p>
      </div>

      <form onSubmit={(event) => { event.preventDefault(); if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) { setError('From date cannot be later than to date.'); return; } fetchReports(filters); }} className="bg-white border rounded-2xl shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4"><Filter className="text-purple-600" size={18} /><h3 className="text-lg font-semibold">Filter Reports</h3></div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            <select name="departmentId" value={filters.departmentId} onChange={handleFilterChange} className="w-full border rounded-lg px-3 py-2">
              <option value="">All Departments</option>
              {departments.map((department: any) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
            <select name="year" value={filters.year} onChange={handleFilterChange} className="w-full border rounded-lg px-3 py-2">
              <option value="">All Years</option>
              {YEAR_OPTIONS.map((year) => <option key={year} value={year}>Year {year}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Semester</label>
            <select name="semester" value={filters.semester} onChange={handleFilterChange} className="w-full border rounded-lg px-3 py-2">
              <option value="">All Semesters</option>
              {SEMESTER_OPTIONS.map((semester) => <option key={semester} value={semester}>Semester {semester}</option>)}
            </select>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">From Date</label><input name="fromDate" type="date" value={filters.fromDate} onChange={handleFilterChange} className="w-full border rounded-lg px-3 py-2" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">To Date</label><input name="toDate" type="date" value={filters.toDate} onChange={handleFilterChange} className="w-full border rounded-lg px-3 py-2" /></div>
        </div>
        <div className="flex flex-wrap gap-3 mt-5">
          <button type="submit" className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">Apply Filters</button>
          <button type="button" onClick={() => { setFilters(defaultFilters); fetchReports(defaultFilters); }} className="px-5 py-2 rounded-lg bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200">Reset</button>
          <button type="button" onClick={exportToExcel} disabled={reportsLoading || attendanceData.length === 0} className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"><Download size={16} /> Export Excel</button>
          <button type="button" onClick={refreshReportsAndReviews} className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200"><RefreshCcw size={16} /> Refresh Live Data</button>
        </div>
      </form>

      {(error || status) && <div className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>{error || status}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-green-500"><div className="flex items-center gap-3"><CheckCircle className="text-green-600" /><div><p className="text-sm text-gray-500 font-medium">Present Records</p><p className="text-2xl font-bold mt-1">{stats.present}</p></div></div></div>
        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-red-500"><div className="flex items-center gap-3"><AlertCircle className="text-red-600" /><div><p className="text-sm text-gray-500 font-medium">Absent Records</p><p className="text-2xl font-bold mt-1">{stats.absent}</p></div></div></div>
        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-amber-500"><div className="flex items-center gap-3"><AlertCircle className="text-amber-600" /><div><p className="text-sm text-gray-500 font-medium">Late Records</p><p className="text-2xl font-bold mt-1">{stats.late}</p></div></div></div>
        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-violet-500"><div className="flex items-center gap-3"><ShieldAlert className="text-violet-600" /><div><p className="text-sm text-gray-500 font-medium">Pending Reviews</p><p className="text-2xl font-bold mt-1">{stats.pendingReviews}</p></div></div></div>
        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-blue-500"><div className="flex items-center gap-3"><Calendar className="text-blue-600" /><div><p className="text-sm text-gray-500 font-medium">Filtered Records</p><p className="text-2xl font-bold mt-1">{stats.total}</p></div></div></div>
      </div>

      <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <div className="p-5 border-b bg-violet-50 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3"><ShieldAlert className="text-violet-600" /><div><h3 className="text-xl font-bold text-slate-900">Pending Recognition Reviews</h3><p className="text-sm text-slate-500">Approve strong borderline scans, reject bad captures, or assign them to the right student.</p></div></div>
          <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">{reviews.length} pending</span>
        </div>
        <div className="p-5">
          {loading ? (
            <p className="text-sm text-gray-400 italic">Loading pending review queue...</p>
          ) : reviews.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No borderline scans are waiting for review right now.</p>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {reviews.map((review: any) => (
                <div key={review.id} className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4 grid grid-cols-[120px,1fr] gap-4">
                  {review.image_url ? <img src={review.image_url} alt="Review capture" className="w-[120px] h-[120px] rounded-xl object-cover border bg-white" /> : <div className="w-[120px] h-[120px] rounded-xl border bg-white flex items-center justify-center text-xs text-gray-400 text-center px-2">No review image stored</div>}
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-violet-700 font-bold">Candidate</div>
                      <div className="text-lg font-bold text-slate-900">{review.candidate_student?.name || 'No candidate linked yet'}</div>
                      <div className="text-sm text-slate-500">{review.candidate_student?.register_number || 'Register number unavailable'}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl bg-white border px-3 py-2"><div className="text-slate-400 text-xs uppercase font-semibold">Period</div><div className="font-semibold text-slate-800">{review.period}</div></div>
                      <div className="rounded-xl bg-white border px-3 py-2"><div className="text-slate-400 text-xs uppercase font-semibold">Confidence</div><div className="font-semibold text-slate-800">{formatConfidence(review.confidence)}</div></div>
                    </div>
                    <div className="text-sm text-slate-500">Captured on {new Date(review.created_at).toLocaleDateString()} at {new Date(review.created_at).toLocaleTimeString()}</div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Assign to student</label>
                      <select value={reviewAssignments[review.id] || ''} onChange={(event) => setReviewAssignments((prev) => ({ ...prev, [review.id]: event.target.value }))} className="w-full rounded-lg border px-3 py-2 bg-white">
                        <option value="">Select student</option>
                        {students.map((student: any) => <option key={student.id} value={student.id}>{student.name} ({student.register_number})</option>)}
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => approveReview(review)} disabled={actionKey === `review-approve-${review.id}`} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><UserCheck size={14} /> {actionKey === `review-approve-${review.id}` ? 'Approving...' : 'Approve'}</button>
                      <button type="button" onClick={() => assignReview(review.id)} disabled={actionKey === `review-assign-${review.id}`} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><SearchCheck size={14} /> {actionKey === `review-assign-${review.id}` ? 'Assigning...' : 'Assign Student'}</button>
                      <button type="button" onClick={() => rejectReview(review.id)} disabled={actionKey === `review-reject-${review.id}`} className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"><XCircle size={14} /> {actionKey === `review-reject-${review.id}` ? 'Rejecting...' : 'Reject'}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="bg-white rounded-2xl shadow-sm overflow-hidden border">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[1500px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-4 font-semibold text-gray-600">Student Name</th>
                <th className="p-4 font-semibold text-gray-600">Register No</th>
                <th className="p-4 font-semibold text-gray-600">Department</th>
                <th className="p-4 font-semibold text-gray-600">Year</th>
                <th className="p-4 font-semibold text-gray-600">Semester</th>
                <th className="p-4 font-semibold text-gray-600">Date & Time</th>
                <th className="p-4 font-semibold text-gray-600">Period</th>
                <th className="p-4 font-semibold text-gray-600">Status</th>
                <th className="p-4 font-semibold text-gray-600">Source</th>
                <th className="p-4 font-semibold text-gray-600">Confidence</th>
                <th className="p-4 font-semibold text-gray-600">Notes</th>
                <th className="p-4 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reportsLoading ? (
                <tr><td colSpan={12} className="p-10 text-center text-gray-400 italic">Loading attendance data...</td></tr>
              ) : attendanceData.length === 0 ? (
                <tr><td colSpan={12} className="p-10 text-center text-gray-400 italic">No attendance records found for the selected filters.</td></tr>
              ) : attendanceData.map((record: any) => (
                <tr key={record.id} className="border-b hover:bg-gray-50 transition align-top">
                  <td className="p-4 font-medium">{record.students?.name || 'N/A'}</td>
                  <td className="p-4 text-gray-600">{record.students?.register_number || 'N/A'}</td>
                  <td className="p-4 text-gray-600">{record.students?.department_name || 'N/A'}</td>
                  <td className="p-4 text-gray-600">{record.students?.year || 'N/A'}</td>
                  <td className="p-4 text-gray-600">{record.students?.semester || 'N/A'}</td>
                  <td className="p-4 text-gray-500">{new Date(record.timestamp).toLocaleDateString()}<br />{new Date(record.timestamp).toLocaleTimeString()}</td>
                  <td className="p-4 text-gray-600">{record.period || record.sessions?.subject || 'General'}</td>
                  <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-bold ${record.status === 'Present' ? 'bg-green-100 text-green-700' : record.status === 'Late' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{record.status}</span></td>
                  <td className="p-4 text-gray-600">{formatSource(record.source)}</td>
                  <td className="p-4 text-gray-600">{formatConfidence(record.confidence)}</td>
                  <td className="p-4 text-gray-500 max-w-[220px] whitespace-pre-wrap">{record.notes || '—'}</td>
                  <td className="p-4"><div className="flex flex-wrap gap-2 min-w-[260px]">
                    {record.status === 'Present' ? <span className="inline-flex items-center rounded bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">No alert needed</span> : <button type="button" onClick={() => sendAlert(record)} disabled={actionKey === `alert-${record.id}`} className="flex items-center gap-2 text-sm bg-red-50 text-red-600 px-3 py-2 rounded hover:bg-red-100 disabled:opacity-50 font-semibold"><PhoneCall size={14} /> {actionKey === `alert-${record.id}` ? 'Sending...' : 'Alert Parent'}</button>}
                    <button type="button" onClick={() => overrideAttendance(record, 'Present')} disabled={actionKey === `override-${record.id}-Present`} className="rounded bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">Set Present</button>
                    <button type="button" onClick={() => overrideAttendance(record, 'Late')} disabled={actionKey === `override-${record.id}-Late`} className="rounded bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50">Set Late</button>
                    <button type="button" onClick={() => overrideAttendance(record, 'Absent')} disabled={actionKey === `override-${record.id}-Absent`} className="rounded bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">Set Absent</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default AdminReports;

