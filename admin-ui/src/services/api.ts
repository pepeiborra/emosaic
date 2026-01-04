import { fetchAuthSession } from 'aws-amplify/auth';
import type {
  Mosaic,
  Job,
  PaginatedResponse,
  UploadUrlResponse,
  CreateMosaicRequest,
  UserListResponse,
  UserActionResponse,
  TileFoldersResponse,
  ImageUploadResult,
  BulkUploadResponse,
  PendingRegistrationsResponse,
  RegistrationActionResponse,
  CaptchaResponse,
  SubmitRegistrationRequest,
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
export async function submitJob(mosaicId: string, setMain = false): Promise<Job> {
  return apiRequest('/jobs', {
    method: 'POST',
    body: JSON.stringify({ mosaic_id: mosaicId, set_main: setMain }),
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

// Tiles endpoints
export async function getTileCount(prefix = 'tiles/', excludedFolders: string[] = []): Promise<{ count: number; prefix: string }> {
  const params = new URLSearchParams({ prefix });
  if (excludedFolders.length > 0) {
    params.set('excluded', excludedFolders.join(','));
  }
  return apiRequest(`/tiles/count?${params}`);
}

export async function listTileFolders(prefix = 'tiles/'): Promise<TileFoldersResponse> {
  const params = new URLSearchParams({ prefix });
  return apiRequest(`/tiles/folders?${params}`);
}

// User management endpoints
export async function listUsers(): Promise<UserListResponse> {
  return apiRequest('/users');
}

export async function createUser(email: string, sendInvite = true): Promise<UserActionResponse> {
  return apiRequest('/users', {
    method: 'POST',
    body: JSON.stringify({ email, send_invite: sendInvite }),
  });
}

export async function deleteUser(username: string): Promise<UserActionResponse> {
  return apiRequest(`/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
}

export async function resendUserInvite(username: string): Promise<UserActionResponse> {
  return apiRequest(`/users/${encodeURIComponent(username)}/resend-invite`, { method: 'POST' });
}

export async function enableUser(username: string): Promise<UserActionResponse> {
  return apiRequest(`/users/${encodeURIComponent(username)}/enable`, { method: 'PUT' });
}

export async function disableUser(username: string): Promise<UserActionResponse> {
  return apiRequest(`/users/${encodeURIComponent(username)}/disable`, { method: 'PUT' });
}

// Image upload endpoints
export async function getBulkUploadUrls(
  files: Array<{ filename: string; content_type: string }>,
  year: string,
  email: string
): Promise<{
  uploads: Array<{ filename: string; upload_url: string; s3_key: string }>;
}> {
  return apiRequest('/images/upload-urls', {
    method: 'POST',
    body: JSON.stringify({ files, year, email }),
  });
}

export async function checkDuplicates(
  hashes: string[]
): Promise<{ duplicates: string[] }> {
  return apiRequest('/images/check-duplicates', {
    method: 'POST',
    body: JSON.stringify({ hashes }),
  });
}

export async function confirmUploads(
  uploads: Array<{ s3_key: string; hash: string; filename: string }>
): Promise<BulkUploadResponse> {
  return apiRequest('/images/confirm', {
    method: 'POST',
    body: JSON.stringify({ uploads }),
  });
}

// Helper function to compute hash of a file
async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Main upload function that handles the full flow
export async function uploadImages(
  files: File[],
  year: string,
  email: string
): Promise<ImageUploadResult[]> {
  const results: ImageUploadResult[] = [];

  // Step 1: Compute hashes for all files
  const fileHashes = await Promise.all(
    files.map(async (file) => ({
      file,
      hash: await computeFileHash(file),
      filename: file.name,
      content_type: file.type,
    }))
  );

  // Step 2: Check for duplicates
  const { duplicates } = await checkDuplicates(fileHashes.map((f) => f.hash));
  const duplicateSet = new Set(duplicates);

  // Mark duplicates
  const nonDuplicates = fileHashes.filter((f) => {
    if (duplicateSet.has(f.hash)) {
      results.push({
        filename: f.filename,
        status: 'duplicate',
      });
      return false;
    }
    return true;
  });

  if (nonDuplicates.length === 0) {
    return results;
  }

  // Step 3: Get presigned URLs for non-duplicate files
  const { uploads } = await getBulkUploadUrls(
    nonDuplicates.map((f) => ({
      filename: f.filename,
      content_type: f.content_type,
    })),
    year,
    email
  );

  // Step 4: Upload files to S3
  const uploadPromises = nonDuplicates.map(async (fileInfo, index) => {
    const upload = uploads[index];
    try {
      const response = await fetch(upload.upload_url, {
        method: 'PUT',
        body: fileInfo.file,
        headers: {
          'Content-Type': fileInfo.content_type,
        },
      });

      if (!response.ok) {
        return {
          filename: fileInfo.filename,
          status: 'error' as const,
          error: `Upload failed: ${response.status}`,
        };
      }

      return {
        filename: fileInfo.filename,
        status: 'success' as const,
        s3_key: upload.s3_key,
        hash: fileInfo.hash,
      };
    } catch (error) {
      return {
        filename: fileInfo.filename,
        status: 'error' as const,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  });

  const uploadResults = await Promise.all(uploadPromises);

  // Step 5: Confirm successful uploads
  const successfulUploads = uploadResults.filter(
    (r): r is { filename: string; status: 'success'; s3_key: string; hash: string } =>
      r.status === 'success' && !!r.s3_key && !!r.hash
  );

  if (successfulUploads.length > 0) {
    await confirmUploads(
      successfulUploads.map((u) => ({
        s3_key: u.s3_key,
        hash: u.hash,
        filename: u.filename,
      }))
    );
  }

  // Combine all results
  results.push(
    ...uploadResults.map((r) => ({
      filename: r.filename,
      status: r.status,
      s3_key: r.s3_key,
      error: r.status === 'error' ? r.error : undefined,
    }))
  );

  return results;
}

// Public registration endpoints (no auth required)
async function publicRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function getCaptcha(): Promise<CaptchaResponse> {
  return publicRequest('/captcha');
}

export async function submitRegistration(data: SubmitRegistrationRequest): Promise<RegistrationActionResponse> {
  return publicRequest('/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Admin registration management endpoints
export async function listPendingRegistrations(): Promise<PendingRegistrationsResponse> {
  return apiRequest('/registrations');
}

export async function approveRegistration(id: string): Promise<RegistrationActionResponse> {
  return apiRequest(`/registrations/${id}/approve`, { method: 'POST' });
}

export async function rejectRegistration(id: string): Promise<RegistrationActionResponse> {
  return apiRequest(`/registrations/${id}/reject`, { method: 'POST' });
}

export type { ImageUploadResult };
