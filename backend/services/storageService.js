import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../utils/supabaseAdminClient.js';

const DEFAULT_REFERENCE_BUCKET = process.env.STUDENT_REFERENCE_BUCKET || 'student-reference-faces';
const DEFAULT_REVIEW_BUCKET = process.env.REVIEW_FACE_BUCKET || 'recognition-review-faces';

const decodeBase64Image = (base64String) => {
    const payload = base64String?.includes(',') ? base64String.split(',')[1] : base64String;
    return Buffer.from(payload || '', 'base64');
};

const uploadBase64Image = async ({ bucketName, folderPath, base64Image, filePrefix = 'image' }) => {
    if (!base64Image) {
        return null;
    }

    const filePath = `${folderPath}/${filePrefix}-${randomUUID()}.jpg`;
    const buffer = decodeBase64Image(base64Image);

    const { error } = await supabaseAdmin
        .storage
        .from(bucketName)
        .upload(filePath, buffer, {
            contentType: 'image/jpeg',
            upsert: true
        });

    if (error) {
        throw new Error(error.message);
    }

    const { data } = supabaseAdmin
        .storage
        .from(bucketName)
        .getPublicUrl(filePath);

    return {
        bucketName,
        imagePath: filePath,
        imageUrl: data?.publicUrl || null
    };
};

export const uploadReferenceImage = async ({ studentId, base64Image, slot }) => uploadBase64Image({
    bucketName: DEFAULT_REFERENCE_BUCKET,
    folderPath: studentId,
    base64Image,
    filePrefix: `reference-${slot}`
});

export const uploadReviewImage = async ({ terminalId, period, base64Image }) => uploadBase64Image({
    bucketName: DEFAULT_REVIEW_BUCKET,
    folderPath: `${terminalId}/${period.toLowerCase()}`,
    base64Image,
    filePrefix: 'review'
});

export const getStoragePublicUrl = (bucketName, imagePath) => {
    if (!bucketName || !imagePath) {
        return null;
    }

    const { data } = supabaseAdmin
        .storage
        .from(bucketName)
        .getPublicUrl(imagePath);

    return data?.publicUrl || null;
};

export const REFERENCE_BUCKET = DEFAULT_REFERENCE_BUCKET;
export const REVIEW_BUCKET = DEFAULT_REVIEW_BUCKET;
