import express from 'express';
import { supabase } from '../utils/supabaseClient.js';
import { getEmbeddings, refreshRecognitionCache } from '../services/aiService.js';
import { uploadReferenceImage } from '../services/storageService.js';

const router = express.Router();
const DEFAULT_DEPARTMENT_NAME = 'CSE';
const MIN_ACCEPTED_ENROLLMENT_IMAGES = Number(process.env.MIN_ACCEPTED_ENROLLMENT_IMAGES || 8);
const DEPARTMENT_ALIASES = {
    CSE: ['CSE', 'Computer Science', 'Computer Science and Engineering'],
    ECE: ['ECE', 'Electronics and Communication Engineering'],
    EEE: ['EEE', 'Electrical and Electronics Engineering'],
    CIVIL: ['CIVIL', 'Civil Engineering'],
    MECH: ['MECH', 'Mechanical Engineering'],
    IT: ['IT', 'Information Technology']
};

const normalizeDepartmentLabel = (value = '') => value.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const formatEmbeddingVector = (embedding = []) => `[${embedding.map((value) => Number(value).toFixed(10)).join(',')}]`;
const normalizeQualityScore = (value) => Number(Number(value || 0).toFixed(6));

const getDepartmentCandidates = (departmentName) => {
    const trimmedDepartmentName = departmentName?.trim();

    if (!trimmedDepartmentName) {
        return [DEFAULT_DEPARTMENT_NAME];
    }

    const matchedAliasGroup = Object.values(DEPARTMENT_ALIASES).find((aliases) =>
        aliases.some((alias) => normalizeDepartmentLabel(alias) === normalizeDepartmentLabel(trimmedDepartmentName))
    );

    return matchedAliasGroup || [trimmedDepartmentName];
};

const resolveDepartment = async (departmentId, departmentName) => {
    if (departmentId) {
        return departmentId;
    }

    const departmentCandidates = getDepartmentCandidates(departmentName?.trim() || DEFAULT_DEPARTMENT_NAME);
    const { data: departments, error: departmentError } = await supabase
        .from('departments')
        .select('id, name');

    const department = departments?.find((item) =>
        departmentCandidates.some((candidate) => normalizeDepartmentLabel(candidate) === normalizeDepartmentLabel(item.name))
    );

    if (departmentError || !department) {
        throw new Error(`Selected department not found. Create '${departmentName}' first or use one of the saved department names.`);
    }

    return department.id;
};

const getDepartmentMap = async (departmentIds = []) => {
    if (departmentIds.length === 0) {
        return new Map();
    }

    const { data: departments, error } = await supabase
        .from('departments')
        .select('id, name')
        .in('id', departmentIds);

    if (error) {
        throw new Error(error.message);
    }

    return new Map((departments || []).map((department) => [department.id, department.name]));
};

const ensureEnrollmentPayload = (enrollmentResponse) => {
    if (!enrollmentResponse?.embeddings?.length) {
        throw new Error('AI service did not return valid face embeddings.');
    }

    if (Number(enrollmentResponse.accepted_count || 0) < MIN_ACCEPTED_ENROLLMENT_IMAGES) {
        throw new Error(`Enrollment needs at least ${MIN_ACCEPTED_ENROLLMENT_IMAGES} good face captures. Please recapture the student with clearer images.`);
    }
};

const insertFaceEmbeddings = async ({ studentId, enrollmentResponse }) => {
    const rows = (enrollmentResponse.embeddings || []).map((embedding, index) => ({
        student_id: studentId,
        embedding: formatEmbeddingVector(embedding),
        capture_slot: enrollmentResponse.accepted_indexes?.[index] ?? index,
        quality_score: normalizeQualityScore(enrollmentResponse.quality_scores?.[index]),
        is_active: true
    }));

    if (rows.length === 0) {
        return;
    }

    const { error } = await supabase
        .from('student_face_embeddings')
        .insert(rows);

    if (error) {
        throw new Error(error.message);
    }
};

const saveReferenceAssets = async ({ studentId, images, enrollmentResponse }) => {
    const referenceIndexes = (enrollmentResponse.reference_indexes || []).slice(0, 3);
    const assets = [];
    const warnings = [];

    for (const slot of referenceIndexes) {
        try {
            const upload = await uploadReferenceImage({
                studentId,
                base64Image: images[slot],
                slot
            });

            if (upload) {
                assets.push({
                    student_id: studentId,
                    bucket_name: upload.bucketName,
                    image_path: upload.imagePath,
                    image_kind: 'reference',
                    quality_score: normalizeQualityScore(
                        enrollmentResponse.quality_scores?.[
                            (enrollmentResponse.accepted_indexes || []).indexOf(slot)
                        ]
                    ),
                    is_active: true
                });
            }
        } catch (error) {
            warnings.push(`Reference image ${slot + 1} upload skipped: ${error.message}`);
        }
    }

    if (assets.length > 0) {
        const { error } = await supabase
            .from('student_face_assets')
            .insert(assets);

        if (error) {
            warnings.push(`Reference image metadata save skipped: ${error.message}`);
        }
    }

    return warnings;
};

const deactivateFaceProfile = async (studentId) => {
    await supabase
        .from('student_face_embeddings')
        .update({ is_active: false })
        .eq('student_id', studentId)
        .eq('is_active', true);

    await supabase
        .from('student_face_assets')
        .update({ is_active: false })
        .eq('student_id', studentId)
        .eq('is_active', true)
        .eq('image_kind', 'reference');
};

router.get('/', async (req, res) => {
    try {
        const {
            query = '',
            activeOnly = 'false',
            departmentId = '',
            year = '',
            semester = ''
        } = req.query;

        let studentQuery = supabase
            .from('students')
            .select('id, register_number, name, dob, blood_group, address, parent_phone, department_id, year, semester, is_active')
            .order('name', { ascending: true });

        if (String(activeOnly).toLowerCase() === 'true') {
            studentQuery = studentQuery.eq('is_active', true);
        }

        if (departmentId) {
            studentQuery = studentQuery.eq('department_id', departmentId);
        }

        if (year) {
            studentQuery = studentQuery.eq('year', Number(year));
        }

        if (semester) {
            studentQuery = studentQuery.eq('semester', Number(semester));
        }

        const { data: students, error } = await studentQuery;

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        let filteredStudents = students || [];

        if (query) {
            const normalizedQuery = String(query).trim().toLowerCase();
            filteredStudents = filteredStudents.filter((student) =>
                student.name?.toLowerCase().includes(normalizedQuery) ||
                student.register_number?.toLowerCase().includes(normalizedQuery)
            );
        }

        const departmentMap = await getDepartmentMap([...new Set(filteredStudents.map((student) => student.department_id).filter(Boolean))]);
        const hydratedStudents = filteredStudents.map((student) => ({
            ...student,
            department_name: departmentMap.get(student.department_id) || 'N/A'
        }));

        return res.json({ students: hydratedStudents });
    } catch (error) {
        console.error('Students fetch error:', error);
        return res.status(500).json({ error: 'Internal server error while fetching students.' });
    }
});

router.get('/departments', async (_req, res) => {
    try {
        const { data: departments, error } = await supabase
            .from('departments')
            .select('id, name')
            .order('name', { ascending: true });

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        return res.json({ departments: departments || [] });
    } catch (error) {
        console.error('Departments fetch error:', error);
        return res.status(500).json({ error: 'Internal server error while fetching departments.' });
    }
});

router.get('/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;

        const { data: student, error } = await supabase
            .from('students')
            .select('id, register_number, name, dob, blood_group, address, year, semester, parent_phone, department_id, is_active')
            .eq('id', studentId)
            .maybeSingle();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }

        const departmentMap = await getDepartmentMap(student.department_id ? [student.department_id] : []);

        return res.json({
            student: {
                ...student,
                department_name: departmentMap.get(student.department_id) || 'N/A'
            }
        });
    } catch (error) {
        console.error('Student fetch error:', error);
        return res.status(500).json({ error: 'Internal server error while fetching student profile.' });
    }
});

router.post('/', async (req, res) => {
    let createdStudentId = null;

    try {
        const {
            register_number,
            name,
            dob,
            blood_group,
            bloodgroup,
            address,
            department_id,
            department_name,
            year,
            semester,
            parent_phone,
            images
        } = req.body;

        const normalizedDob = dob || null;
        const normalizedBloodGroup = blood_group || bloodgroup || null;
        const normalizedAddress = address || null;
        const normalizedDepartmentName = department_name?.trim() || DEFAULT_DEPARTMENT_NAME;

        if (!register_number || !name || !images || images.length < 15) {
            return res.status(400).json({ error: 'Missing required fields or insufficient images (need 15)' });
        }

        const resolvedDepartmentId = await resolveDepartment(department_id, normalizedDepartmentName);
        const enrollmentResponse = await getEmbeddings(images);
        ensureEnrollmentPayload(enrollmentResponse);

        const { data: createdStudents, error: studentError } = await supabase
            .from('students')
            .insert([{
                register_number,
                name,
                dob: normalizedDob,
                blood_group: normalizedBloodGroup,
                address: normalizedAddress,
                department_id: resolvedDepartmentId,
                year,
                semester,
                parent_phone,
                is_active: true
            }])
            .select();

        if (studentError) {
            if (studentError.code === '23505') {
                return res.status(409).json({ error: 'Student with this register number already exists' });
            }

            return res.status(500).json({
                error: 'Database insert failed',
                details: studentError.details || studentError.message
            });
        }

        createdStudentId = createdStudents?.[0]?.id;
        await insertFaceEmbeddings({ studentId: createdStudentId, enrollmentResponse });
        const warnings = await saveReferenceAssets({ studentId: createdStudentId, images, enrollmentResponse });

        try {
            await refreshRecognitionCache();
        } catch (cacheError) {
            warnings.push(`Recognition cache refresh skipped: ${cacheError.message}`);
        }

        return res.status(201).json({
            message: 'Student registered successfully',
            studentId: createdStudentId,
            acceptedCount: enrollmentResponse.accepted_count,
            rejectedCount: enrollmentResponse.rejected?.length || 0,
            warnings
        });
    } catch (error) {
        if (createdStudentId) {
            await supabase.from('student_face_embeddings').delete().eq('student_id', createdStudentId);
            await supabase.from('student_face_assets').delete().eq('student_id', createdStudentId);
            await supabase.from('students').delete().eq('id', createdStudentId);
        }

        console.error('Registration error:', error);
        return res.status(500).json({ error: 'Internal server error while registering student.', details: error.message });
    }
});

router.put('/:studentId/re-enroll-face', async (req, res) => {
    try {
        const { studentId } = req.params;
        const { images } = req.body;

        if (!images || images.length < 15) {
            return res.status(400).json({ error: 'At least 15 images are required for face re-enrollment.' });
        }

        const { data: student, error: studentError } = await supabase
            .from('students')
            .select('id')
            .eq('id', studentId)
            .maybeSingle();

        if (studentError || !student) {
            return res.status(404).json({ error: 'Student not found.' });
        }

        const enrollmentResponse = await getEmbeddings(images);
        ensureEnrollmentPayload(enrollmentResponse);
        await deactivateFaceProfile(studentId);
        await insertFaceEmbeddings({ studentId, enrollmentResponse });
        const warnings = await saveReferenceAssets({ studentId, images, enrollmentResponse });

        try {
            await refreshRecognitionCache();
        } catch (cacheError) {
            warnings.push(`Recognition cache refresh skipped: ${cacheError.message}`);
        }

        return res.json({
            message: 'Student face data re-enrolled successfully.',
            acceptedCount: enrollmentResponse.accepted_count,
            warnings
        });
    } catch (error) {
        console.error('Face re-enrollment error:', error);
        return res.status(500).json({
            error: 'Internal server error while re-enrolling student face.',
            details: error.message
        });
    }
});

export default router;
