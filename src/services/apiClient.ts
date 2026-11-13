import axios, { AxiosError } from 'axios';

const rawApiBase = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL =
  rawApiBase && !/^https?:\/\/(127\.0\.0\.1|localhost):5000(\/|$)/i.test(rawApiBase)
    ? rawApiBase
    : '/api';

export const TOKEN_STORAGE_KEY = 'traffix_access_token';
export const REFRESH_STORAGE_KEY = 'traffix_refresh_token';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<any>) => {
    const originalRequest = error.config as any;
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/login') &&
      !originalRequest.url?.includes('/auth/refresh')
    ) {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem(REFRESH_STORAGE_KEY);
      if (refreshToken) {
        if (!refreshPromise) {
          refreshPromise = axios
            .post(`${API_BASE_URL}/auth/refresh`, { refreshToken })
            .then((res) => {
              const newAccess = res.data?.data?.accessToken;
              const newRefresh = res.data?.data?.refreshToken;
              if (newAccess) localStorage.setItem(TOKEN_STORAGE_KEY, newAccess);
              if (newRefresh) localStorage.setItem(REFRESH_STORAGE_KEY, newRefresh);
              return newAccess || null;
            })
            .catch(() => {
              localStorage.removeItem(TOKEN_STORAGE_KEY);
              localStorage.removeItem(REFRESH_STORAGE_KEY);
              return null;
            })
            .finally(() => {
              refreshPromise = null;
            });
        }
        const nextToken = await refreshPromise;
        if (nextToken) {
          originalRequest.headers.Authorization = `Bearer ${nextToken}`;
          return apiClient(originalRequest);
        }
      }
    }

    const serverMsg =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      error.message ||
      'Request failed';
    const details = error.response?.data?.error?.details;
    const enriched = new Error(serverMsg) as Error & {
      status?: number;
      code?: string;
      details?: unknown;
    };
    enriched.status = error.response?.status;
    enriched.code = error.response?.data?.error?.code;
    enriched.details = details;
    return Promise.reject(enriched);
  }
);
