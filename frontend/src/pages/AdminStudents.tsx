import React, { useEffect, useMemo, useState } from 'react';
import { Download, Filter, GraduationCap, RefreshCcw, Users } from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../lib/api';
const YEAR_OPTIONS = ['1', '2', '3', '4'];
const SEMESTER_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8'];

const defaultFilters = {
  departmentId: '',
  year: '',
  semester: ''
};

const getExportFileName = (filters: typeof defaultFilters) => {
  const departmentPart = filters.departmentId || 'all-departments';
  const yearPart = filters.year || 'all-years';
  const semesterPart = filters.semester || 'all-semesters';
  return `student-data-${departmentPart}-${yearPart}-${semesterPart}.xlsx`;
};

const AdminStudents: React.FC = () => {
  const [students, setStudents] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);
  const [error, setError] = useState('');

  const selectedDepartmentName = useMemo(
    () => departments.find((department: any) => department.id === filters.departmentId)?.name || 'All Departments',
    [departments, filters.departmentId]
  );

  const buildParams = (activeFilters: typeof defaultFilters) => {
    const params = new URLSearchParams();
    params.append('activeOnly', 'true');
    if (activeFilters.departmentId) params.append('departmentId', activeFilters.departmentId);
    if (activeFilters.year) params.append('year', activeFilters.year);
    if (activeFilters.semester) params.append('semester', activeFilters.semester);
    return params.toString();
  };

  const fetchDepartments = async () => {
    try {
      const res = await api.get('/students/departments');
      setDepartments(res.data.departments || []);
    } catch (err: any) {
      const backendError = err.response?.data;
      setDepartments([]);
      setError([backendError?.error, backendError?.details, backendError?.message].filter(Boolean).join(' - ') || 'Failed to load departments.');
    }
  };

  const fetchStudents = async (activeFilters = filters) => {
    setTableLoading(true);
    try {
      setError('');
      const queryString = buildParams(activeFilters);
      const res = await api.get(`/students${queryString ? `?${queryString}` : ''}`);
      setStudents(res.data.students || []);
    } catch (err: any) {
      const backendError = err.response?.data;
      setStudents([]);
      setError([backendError?.error, backendError?.details, backendError?.message].filter(Boolean).join(' - ') || 'Failed to load student data.');
    } finally {
      setTableLoading(false);
    }
  };

  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      try {
        await Promise.all([fetchDepartments(), fetchStudents(defaultFilters)]);
      } catch (err: any) {
        const backendError = err.response?.data;
        setError((prev) => prev || [backendError?.error, backendError?.details, backendError?.message].filter(Boolean).join(' - ') || 'Failed to load student page.');
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, []);

  const handleFilterChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = event.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const exportToExcel = () => {
    if (students.length === 0) {
      alert('No student data available to export.');
      return;
    }

    const rows = students.map((student, index) => ({
      'S.No': index + 1,
      Name: student.name || 'N/A',
      'Register Number': student.register_number || 'N/A',
      Department: student.department_name || 'N/A',
      Semester: student.semester || 'N/A',
      Year: student.year || 'N/A',
      DOB: student.dob || 'N/A',
      Address: student.address || 'N/A',
      'Parent Phone': student.parent_phone || 'N/A',
      'Blood Group': student.blood_group || 'N/A'
    }));

    const worksheet = XLSX.utils.aoa_to_sheet([]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Student Data');
    XLSX.utils.sheet_add_aoa(worksheet, [
      ['Student Data'],
      ['Department', selectedDepartmentName],
      ['Year', filters.year || 'All Years'],
      ['Semester', filters.semester || 'All Semesters'],
      ['Total Students', students.length],
      []
    ], { origin: 'A1' });
    XLSX.utils.sheet_add_json(worksheet, rows, { origin: 'A7', skipHeader: false });
    XLSX.writeFile(workbook, getExportFileName(filters));
  };

  return (
    <div className="container mx-auto p-4 max-w-7xl space-y-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold flex items-center gap-2">
          <GraduationCap className="text-blue-600" />
          Student Data
        </h2>
        <p className="text-gray-500">
          Filter student records by department, year, and semester, then export the exact list you are viewing as Excel.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          fetchStudents(filters);
        }}
        className="bg-white border rounded-2xl shadow-sm p-5"
      >
        <div className="flex items-center gap-2 mb-4">
          <Filter className="text-blue-600" size={18} />
          <h3 className="text-lg font-semibold">Filter Students</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            <select name="departmentId" value={filters.departmentId} onChange={handleFilterChange} className="w-full border rounded-lg px-3 py-2">
              <option value="">All Departments</option>
              {departments.map((department: any) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
            <select name="year" value={filters.year} onChange={handleFilterChange} className="w-full border rounded-lg px-3 py-2">
              <option value="">All Years</option>
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>
                  Year {year}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Semester</label>
            <select name="semester" value={filters.semester} onChange={handleFilterChange} className="w-full border rounded-lg px-3 py-2">
              <option value="">All Semesters</option>
              {SEMESTER_OPTIONS.map((semester) => (
                <option key={semester} value={semester}>
                  Semester {semester}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mt-5">
          <button type="submit" className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">
            Apply Filters
          </button>
          <button
            type="button"
            onClick={() => {
              setFilters(defaultFilters);
              fetchStudents(defaultFilters);
            }}
            className="px-5 py-2 rounded-lg bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={exportToExcel}
            disabled={tableLoading || students.length === 0}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            <Download size={16} />
            Export Excel
          </button>
          <button
            type="button"
            onClick={() => fetchStudents(filters)}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200"
          >
            <RefreshCcw size={16} />
            Refresh Data
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-blue-500">
          <div className="flex items-center gap-3">
            <Users className="text-blue-600" />
            <div>
              <p className="text-sm text-gray-500 font-medium">Filtered Students</p>
              <p className="text-2xl font-bold mt-1">{students.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-violet-500">
          <div className="flex items-center gap-3">
            <GraduationCap className="text-violet-600" />
            <div>
              <p className="text-sm text-gray-500 font-medium">Department</p>
              <p className="text-lg font-bold mt-1">{selectedDepartmentName}</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-amber-500">
          <div className="flex items-center gap-3">
            <Filter className="text-amber-600" />
            <div>
              <p className="text-sm text-gray-500 font-medium">Academic Filter</p>
              <p className="text-lg font-bold mt-1">
                {filters.year ? `Y${filters.year}` : 'All Years'} / {filters.semester ? `S${filters.semester}` : 'All Semesters'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <section className="bg-white rounded-2xl shadow-sm overflow-hidden border">
        <div className="p-5 border-b bg-blue-50">
          <h3 className="text-xl font-bold text-slate-900">Registered Student Records</h3>
          <p className="text-sm text-slate-500 mt-1">All fields are linked directly from the live student records stored in Supabase.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[1400px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-4 font-semibold text-gray-600">S.No</th>
                <th className="p-4 font-semibold text-gray-600">Name</th>
                <th className="p-4 font-semibold text-gray-600">Register No.</th>
                <th className="p-4 font-semibold text-gray-600">Department</th>
                <th className="p-4 font-semibold text-gray-600">Semester</th>
                <th className="p-4 font-semibold text-gray-600">Year</th>
                <th className="p-4 font-semibold text-gray-600">DOB</th>
                <th className="p-4 font-semibold text-gray-600">Address</th>
                <th className="p-4 font-semibold text-gray-600">Parent No.</th>
                <th className="p-4 font-semibold text-gray-600">Blood Group</th>
              </tr>
            </thead>
            <tbody>
              {loading || tableLoading ? (
                <tr>
                  <td colSpan={10} className="p-10 text-center text-gray-400 italic">
                    Loading student records...
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-10 text-center text-gray-400 italic">
                    No student records found for the selected filters.
                  </td>
                </tr>
              ) : (
                students.map((student: any, index) => (
                  <tr key={student.id} className="border-b hover:bg-gray-50 transition align-top">
                    <td className="p-4 text-gray-500">{index + 1}</td>
                    <td className="p-4 font-medium">{student.name || 'N/A'}</td>
                    <td className="p-4 text-gray-600">{student.register_number || 'N/A'}</td>
                    <td className="p-4 text-gray-600">{student.department_name || 'N/A'}</td>
                    <td className="p-4 text-gray-600">{student.semester || 'N/A'}</td>
                    <td className="p-4 text-gray-600">{student.year || 'N/A'}</td>
                    <td className="p-4 text-gray-600">{student.dob || 'N/A'}</td>
                    <td className="p-4 text-gray-600 whitespace-pre-line">{student.address || 'N/A'}</td>
                    <td className="p-4 text-gray-600">{student.parent_phone || 'N/A'}</td>
                    <td className="p-4 text-gray-600">{student.blood_group || 'N/A'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default AdminStudents;
