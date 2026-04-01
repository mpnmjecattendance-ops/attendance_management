import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import StudentRegistration from './pages/StudentRegistration';
import AttendanceCapture from './pages/AttendanceCapture';
import StudentDashboard from './pages/StudentDashboard';
import AdminReports from './pages/AdminReports';
import AttendanceKiosk from './pages/AttendanceKiosk';
import AdminSettings from './pages/AdminSettings';
import AdminStudents from './pages/AdminStudents';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-blue-600 text-white p-4 shadow-md">
          <h1 className="text-2xl font-bold text-center">AI Face Recognition Attendance System</h1>
        </header>
        
        <main className="flex-1 p-6">
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/register-student" element={<StudentRegistration />} />
            <Route path="/admin/students" element={<AdminStudents />} />
            <Route path="/admin/reports" element={<AdminReports />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
            <Route path="/capture" element={<AttendanceCapture />} />
            <Route path="/kiosk" element={<AttendanceKiosk />} />
            <Route path="/student" element={<StudentDashboard />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
