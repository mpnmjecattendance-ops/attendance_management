import React, { useCallback, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { api } from '../lib/api';

const DEPARTMENT_OPTIONS = ['ECE', 'EEE', 'CSE', 'CIVIL', 'MECH', 'IT'];
const OTHER_DEPARTMENT_OPTION = 'OTHER';

type RegistrationResult = {
    acceptedCount?: number;
    rejectedCount?: number;
    warnings?: string[];
};

const StudentRegistration: React.FC = () => {
    const webcamRef = useRef<Webcam>(null);
    const [images, setImages] = useState<string[]>([]);
    const [status, setStatus] = useState('');
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<RegistrationResult | null>(null);
    const [selectedDepartmentOption, setSelectedDepartmentOption] = useState('CSE');
    const [formData, setFormData] = useState({
        register_number: '',
        name: '',
        dob: '',
        blood_group: '',
        address: '',
        department_name: 'CSE',
        year: '1',
        semester: '1',
        parent_phone: ''
    });

    const capture = useCallback(() => {
        const imageSrc = webcamRef.current?.getScreenshot();
        if (imageSrc && images.length < 15) {
            setImages((prev) => [...prev, imageSrc]);
        }
    }, [images.length]);

    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = event.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleDepartmentChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const { value } = event.target;
        setSelectedDepartmentOption(value);
        setFormData((prev) => ({
            ...prev,
            department_name: value === OTHER_DEPARTMENT_OPTION ? '' : value
        }));
    };

    const submitRegistration = async () => {
        if (images.length < 15) {
            setStatus('Please capture all 15 images.');
            return;
        }

        if (selectedDepartmentOption === OTHER_DEPARTMENT_OPTION && !formData.department_name.trim()) {
            setStatus('Please type the custom department name.');
            return;
        }

        setSaving(true);
        setResult(null);
        setStatus('Registering student, validating captures, and generating face embeddings...');
        try {
            const payload = { ...formData, images };
            const response = await api.post('/students', payload);
            setStatus(`Success: ${response.data.message}`);
            setResult({
                acceptedCount: response.data.acceptedCount,
                rejectedCount: response.data.rejectedCount,
                warnings: response.data.warnings || []
            });
            setImages([]);
        } catch (error: any) {
            const backendError = error.response?.data;
            const detailedMessage = [backendError?.error, backendError?.details].filter(Boolean).join(' - ');
            setStatus(`Error: ${detailedMessage || error.message}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto bg-white p-6 rounded-lg shadow-md mt-6 space-y-6">
            <h2 className="text-2xl font-bold border-b pb-2">Student Registration (Admin Panel)</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                    <h3 className="text-lg font-semibold mb-4 text-blue-600">Student Details</h3>
                    <div className="space-y-4">
                        <div><label className="block text-sm font-medium">Name</label><input name="name" value={formData.name} onChange={handleInputChange} className="w-full border rounded p-2" /></div>
                        <div><label className="block text-sm font-medium">Register Number</label><input name="register_number" value={formData.register_number} onChange={handleInputChange} className="w-full border rounded p-2" /></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="block text-sm font-medium">DOB</label><input name="dob" type="date" value={formData.dob} onChange={handleInputChange} className="w-full border rounded p-2" /></div>
                            <div><label className="block text-sm font-medium">Blood Group</label><input name="blood_group" value={formData.blood_group} onChange={handleInputChange} placeholder="Ex: O+" className="w-full border rounded p-2" /></div>
                        </div>
                        <div><label className="block text-sm font-medium">Address</label><textarea name="address" value={formData.address} onChange={handleInputChange} rows={3} className="w-full border rounded p-2" /></div>
                        <div><label className="block text-sm font-medium">Parent Phone</label><input name="parent_phone" value={formData.parent_phone} onChange={handleInputChange} className="w-full border rounded p-2" /></div>
                        <div>
                            <label className="block text-sm font-medium">Department</label>
                            <select value={selectedDepartmentOption} onChange={handleDepartmentChange} className="w-full border rounded p-2">
                                {DEPARTMENT_OPTIONS.map((department) => <option key={department} value={department}>{department}</option>)}
                                <option value={OTHER_DEPARTMENT_OPTION}>Other</option>
                            </select>
                        </div>
                        {selectedDepartmentOption === OTHER_DEPARTMENT_OPTION && (
                            <div><label className="block text-sm font-medium">Custom Department</label><input name="department_name" value={formData.department_name} onChange={handleInputChange} placeholder="Type department name" className="w-full border rounded p-2" /></div>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="block text-sm font-medium">Year</label><input name="year" value={formData.year} type="number" onChange={handleInputChange} className="w-full border rounded p-2" /></div>
                            <div><label className="block text-sm font-medium">Semester</label><input name="semester" value={formData.semester} type="number" onChange={handleInputChange} className="w-full border rounded p-2" /></div>
                        </div>
                    </div>
                </div>

                <div>
                    <h3 className="text-lg font-semibold mb-4 text-blue-600">Face Capture Server</h3>
                    <div className="bg-gray-100 p-3 rounded flex flex-col items-center">
                        <Webcam audio={false} ref={webcamRef} screenshotFormat="image/jpeg" width={360} height={260} className="rounded-lg border-2 border-dashed border-gray-400" />
                        <p className="text-sm mt-3 text-gray-500">Captured: {images.length} / 15</p>
                        <p className="text-xs text-gray-400 mt-1 text-center">The AI service now accepts only clear single-face captures and keeps the best reference images for later review.</p>
                        <div className="mt-4 flex space-x-2">
                            <button onClick={capture} disabled={images.length >= 15} className={`px-4 py-2 text-white rounded ${images.length >= 15 ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}>Capture Frame</button>
                            <button onClick={() => setImages([])} className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600">Reset</button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="border-t pt-4 space-y-4">
                <button onClick={submitRegistration} disabled={saving} className="w-full md:w-auto px-8 py-3 bg-green-600 text-white font-bold rounded hover:bg-green-700 shadow-md disabled:opacity-50">
                    {saving ? 'Submitting...' : 'Submit Registration'}
                </button>
                {status && <p className={`p-3 rounded ${status.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{status}</p>}
                {result && (
                    <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-700 space-y-2">
                        <div><strong>Accepted captures:</strong> {result.acceptedCount ?? 0}</div>
                        <div><strong>Rejected captures:</strong> {result.rejectedCount ?? 0}</div>
                        {result.warnings && result.warnings.length > 0 && (
                            <div>
                                <strong>Warnings:</strong>
                                <ul className="list-disc pl-5 mt-1 space-y-1">
                                    {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {images.length > 0 && (
                <div>
                    <h4 className="text-md font-semibold mb-3">Captured Frames</h4>
                    <div className="flex flex-wrap gap-2">
                        {images.map((src, idx) => <img key={idx} src={src} className="w-16 h-16 object-cover rounded border" alt={`Face ${idx + 1}`} />)}
                    </div>
                </div>
            )}
        </div>
    );
};

export default StudentRegistration;

