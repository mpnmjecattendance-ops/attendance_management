import React from 'react';
import { Link } from 'react-router-dom';

const AdminDashboard: React.FC = () => {
    return (
        <div className="container mx-auto">
            <h2 className="text-3xl font-bold mb-8">Admin Dashboard</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-lg shadow border-t-4 border-blue-500">
                    <h3 className="text-xl font-bold mb-2">Student Registration</h3>
                    <p className="text-gray-600 mb-4">Register new students and capture multi-angle face embeddings.</p>
                    <Link to="/admin/register-student" className="text-blue-600 font-semibold hover:underline">
                        Go to Registration &rarr;
                    </Link>
                </div>

                <div className="bg-white p-6 rounded-lg shadow border-t-4 border-cyan-500">
                    <h3 className="text-xl font-bold mb-2">Student Data</h3>
                    <p className="text-gray-600 mb-4">Filter registered students by department, year, and semester, then export the full records as Excel.</p>
                    <Link to="/admin/students" className="text-cyan-700 font-semibold hover:underline bg-cyan-50 px-4 py-2 rounded-lg inline-block">
                        View Student Data &rarr;
                    </Link>
                </div>
                
                <div className="bg-white p-6 rounded-lg shadow border-t-4 border-green-500">
                    <h3 className="text-xl font-bold mb-2">Attendance Terminal</h3>
                    <p className="text-gray-600 mb-4">Launch the standalone AI kiosk for students to scan in at the campus entrance.</p>
                    <Link to="/kiosk" target="_blank" className="text-green-600 font-semibold hover:underline bg-green-50 px-4 py-2 rounded-lg inline-block">
                        Open Terminal &rarr;
                    </Link>
                </div>

                <div className="bg-white p-6 rounded-lg shadow border-t-4 border-purple-500">
                    <h3 className="text-xl font-bold mb-2">Reports & Alerts</h3>
                    <p className="text-gray-600 mb-4">View attendance reports and trigger SMS/Voice notifications for absentees.</p>
                    <Link to="/admin/reports" className="text-purple-600 font-semibold hover:underline bg-purple-50 px-4 py-2 rounded-lg inline-block">
                        View Reports &rarr;
                    </Link>
                </div>

                <div className="bg-white p-6 rounded-lg shadow border-t-4 border-amber-500">
                    <h3 className="text-xl font-bold mb-2">Attendance Settings</h3>
                    <p className="text-gray-600 mb-4">Configure morning and evening attendance windows and auto-mark absentees after each window closes.</p>
                    <Link to="/admin/settings" className="text-amber-700 font-semibold hover:underline bg-amber-50 px-4 py-2 rounded-lg inline-block">
                        Open Settings &rarr;
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
