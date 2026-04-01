import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const STUDENT_SESSION_KEY = 'attendance_student_session';

const Login: React.FC = () => {
    const [loginType, setLoginType] = useState<'student' | 'institution'>('student');
    const navigate = useNavigate();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        
        const username = (e.target as any)[0].value;
        const password = (e.target as any)[1]?.value;

        if (loginType === 'institution') {
            try {
                const response = await api.post('/auth/login', {
                    username,
                    password
                });
                if (response.data.success) {
                    navigate('/admin');
                }
            } catch (err: any) {
                alert(err.response?.data?.message || 'Login failed');
            }
        } else {
            try {
                const response = await api.post('/auth/student-login', {
                    register_number: username
                });

                if (response.data.success && response.data.student) {
                    localStorage.setItem(STUDENT_SESSION_KEY, JSON.stringify(response.data.student));
                    navigate('/student');
                }
            } catch (err: any) {
                alert(err.response?.data?.message || 'Student login failed');
            }
        }
    };

    return (
        <div className="max-w-md mx-auto mt-20 bg-white p-8 rounded-lg shadow-md border border-gray-200">
            <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">
                {loginType === 'student' ? 'Student Login' : 'Institution Login'}
            </h2>
            
            <div className="flex justify-center mb-6 space-x-4">
                <button 
                    className={`px-4 py-2 rounded ${loginType === 'student' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                    onClick={() => setLoginType('student')}
                >
                    Student
                </button>
                <button 
                    className={`px-4 py-2 rounded ${loginType === 'institution' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                    onClick={() => setLoginType('institution')}
                >
                    Institution
                </button>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
                {loginType === 'student' ? (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Register Number</label>
                        <input className="w-full px-3 py-2 border rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500" type="text" placeholder="Enter Registration Number" required />
                    </div>
                ) : (
                    <>
                        <div>
                            <label className="block text-gray-700 text-sm font-bold mb-2">Username / Email</label>
                            <input className="w-full px-3 py-2 border rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500" type="text" placeholder="Admin/Faculty Details" required />
                        </div>
                        <div>
                            <label className="block text-gray-700 text-sm font-bold mb-2">Password</label>
                            <input className="w-full px-3 py-2 border rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500" type="password" placeholder="Password" required />
                        </div>
                    </>
                )}
                <button className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition" type="submit">
                    Login
                </button>
            </form>
        </div>
    );
};

export default Login;
