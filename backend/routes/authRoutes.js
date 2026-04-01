import express from 'express';
import { supabase } from '../utils/supabaseClient.js';
// import { login, studentLogin } from '../controllers/authController.js'; 

const router = express.Router();

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    // Admin Credentials from Environment Variables
    if (username === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
        return res.json({ 
            success: true, 
            message: "Login successful", 
            user: { name: 'Admin', role: 'ADMIN', email: username } 
        });
    }

    // Role-Based or Normal User validation logic (placeholder)
    res.status(401).json({ success: false, message: "Invalid credentials" });
});

router.post('/student-login', async (req, res) => {
    try {
        const { register_number } = req.body;

        if (!register_number) {
            return res.status(400).json({ success: false, message: 'Register number is required' });
        }

        const { data: student, error } = await supabase
            .from('students')
            .select('id, register_number, name, dob, blood_group, address, year, semester, parent_phone, department_id, is_active')
            .eq('register_number', register_number)
            .maybeSingle();

        if (error) {
            return res.status(500).json({ success: false, message: error.message });
        }

        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        if (student.is_active === false) {
            return res.status(403).json({ success: false, message: 'This student is currently inactive.' });
        }

        let departmentName = 'N/A';

        if (student.department_id) {
            const { data: department } = await supabase
                .from('departments')
                .select('name')
                .eq('id', student.department_id)
                .maybeSingle();

            departmentName = department?.name || departmentName;
        }

        return res.json({
            success: true,
            message: 'Student login successful',
            student: {
                ...student,
                department_name: departmentName
            }
        });
    } catch (error) {
        console.error('Student login error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error during student login' });
    }
});

export default router;
