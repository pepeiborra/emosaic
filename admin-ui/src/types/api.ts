export interface MosaicConfig {
  tile_size: number;
  mode: number;
  tint_opacity: number;
  no_repeat?: boolean;
  crop?: boolean;
  randomize?: number;
}

export interface Mosaic {
  id: string;
  title?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  is_main: boolean;
  created_at: string;
  updated_at?: string;
  config: MosaicConfig;
  source_image_path?: string;
  s3_path?: string;
  thumbnail_path?: string;
}

export interface Job {
  id: string;
  mosaic_id: string;
  status: 'pending' | 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  started_at: string;
  completed_at?: string;
  error_message?: string;
  batch_job_id?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  lastKey?: string;
  count: number;
}

export interface UploadUrlResponse {
  upload_url: string;
  s3_key: string;
}

export interface CreateMosaicRequest {
  title?: string;
  source_image_path: string;
  config: MosaicConfig;
}

export interface SubmitJobRequest {
  mosaic_id: string;
}
