import axios from 'axios';

const AI_URL = process.env.AI_SERVICE_URL || process.env.AI_URL || 'http://localhost:8001';
const buildAiServiceError = (error, fallbackMessage) => {
    const data = error.response?.data;
    const detail = data?.detail;
    const normalizedDetail = typeof detail === 'string'
        ? detail
        : data?.message || error.message || fallbackMessage;
    const wrapped = new Error(normalizedDetail || fallbackMessage);
    wrapped.statusCode = error.response?.status || 500;
    wrapped.aiData = data || null;
    return wrapped;
};

export const getEmbeddings = async (imagesBase64) => {
    try {
        const response = await axios.post(`${AI_URL}/register`, {
            images: imagesBase64
        });
        return response.data;
    } catch (error) {
        const wrapped = buildAiServiceError(error, 'Failed to get embeddings from AI service.');
        wrapped.message = `Failed to get embeddings from AI service: ${wrapped.message}`;
        throw wrapped;
    }
};

export const recognizeFace = async (imageBase64, terminalId = 'campus-gate-1', enforceGuide = false) => {
    try {
        const response = await axios.post(`${AI_URL}/recognize`, {
            image: imageBase64,
            terminal_id: terminalId,
            enforce_guide: enforceGuide
        });
        return response.data;
    } catch (error) {
        if (error.response?.status === 400 || error.response?.status === 422) {
            const detail = error.response?.data?.detail;
            const detailText = typeof detail === 'string' ? detail : '';
            return {
                status: 'invalid_frame',
                message: detailText || 'Camera frame could not be read clearly. Hold steady and try again.'
            };
        }

        const wrapped = buildAiServiceError(error, 'Failed to recognize face via AI service.');
        wrapped.message = `Failed to recognize face via AI service: ${wrapped.message}`;
        throw wrapped;
    }
};

export const refreshRecognitionCache = async () => {
    try {
        const response = await axios.post(`${AI_URL}/refresh-cache`);
        return response.data;
    } catch (error) {
        const wrapped = buildAiServiceError(error, 'Failed to refresh AI recognition cache.');
        wrapped.message = `Failed to refresh AI recognition cache: ${wrapped.message}`;
        throw wrapped;
    }
};
