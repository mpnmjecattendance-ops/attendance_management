import axios from 'axios';

const rawApiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:5000').trim();

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

export const API_BASE_URL = normalizeBaseUrl(rawApiUrl);
export const API_V1_BASE_URL = `${API_BASE_URL}/api/v1`;

export const api = axios.create({
    baseURL: API_V1_BASE_URL
});
