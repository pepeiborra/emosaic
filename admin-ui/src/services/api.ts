import { fetchAuthSession } from 'aws-amplify/auth';
import type {
  Mosaic,
  Job,
  PaginatedResponse,
  UploadUrlResponse,
  CreateMosaicRequest,
} from '../types/api';

// In development, use /api which is proxied by Vite
// In production, use the full API Gateway URL from environment
const API_BASE = import.meta.env.DEV ? '/api' : import.meta.env.VITE_API_URL;

async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (token) {
      return {
        'Content-Type': 'application/json',
        Authorization: token,
      };
    }
  } catch (error) {
    console.error('Failed to get auth session:', error);
  }
  return {
    'Content-Type': 'application/json',
  };
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// Mosaic endpoints
export async function listMosaics(
  limit = 20,
  lastKey?: string
): Promise<PaginatedResponse<Mosaic>> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (lastKey) params.set('lastKey', lastKey);
  const response = await apiRequest<{ mosaics: Mosaic[]; count: number; lastKey?: string }>(`/mosaics?${params}`);
  return { items: response.mosaics, count: response.count, lastKey: response.lastKey };
}

export async function getMosaic(id: string, includeJobs = false): Promise<Mosaic & { jobs?: Job[] }> {
  const params = includeJobs ? '?include_jobs=true' : '';
  return apiRequest(`/mosaics/${id}${params}`);
}

export async function createMosaic(data: CreateMosaicRequest): Promise<Mosaic> {
  return apiRequest('/mosaics', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteMosaic(id: string): Promise<void> {
  await apiRequest(`/mosaics/${id}`, { method: 'DELETE' });
}

export async function setMainMosaic(id: string): Promise<Mosaic> {
  return apiRequest(`/mosaics/${id}/main`, { method: 'PUT' });
}

// Job endpoints
export async function submitJob(mosaicId: string): Promise<Job> {
  return apiRequest('/jobs', {
    method: 'POST',
    body: JSON.stringify({ mosaic_id: mosaicId }),
  });
}

export async function getJob(id: string): Promise<Job> {
  return apiRequest(`/jobs/${id}`);
}

export async function listJobs(
  limit = 20,
  lastKey?: string,
  status?: string,
  mosaicId?: string
): Promise<PaginatedResponse<Job>> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (lastKey) params.set('lastKey', lastKey);
  if (status) params.set('status', status);
  if (mosaicId) params.set('mosaic_id', mosaicId);
  const response = await apiRequest<{ jobs: Job[]; count: number; lastKey?: string }>(`/jobs?${params}`);
  return { items: response.jobs, count: response.count, lastKey: response.lastKey };
}

export async function cancelJob(id: string): Promise<void> {
  await apiRequest(`/jobs/${id}/cancel`, { method: 'DELETE' });
}

// Upload endpoints
export async function getUploadUrl(
  contentType: string,
  filename: string
): Promise<UploadUrlResponse> {
  return apiRequest('/upload-url', {
    method: 'POST',
    body: JSON.stringify({ content_type: contentType, filename }),
  });
}

export async function uploadFileToS3(
  file: File,
  uploadUrl: string
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }
}
