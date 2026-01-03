export interface MosaicConfig {
  tile_size: number;
  mode: number;
  tint_opacity: number;
  no_repeat?: boolean;
  crop?: boolean;
  randomize?: number;
  downsample?: number;
  excluded_folders?: string[];
}

/** Statistics about a tile's usage frequency */
export interface TileUsage {
  path: string;
  count: number;
}

/** Statistics about a tile's color match quality */
export interface TileMatch {
  path: string;
  distance: number;
  position: [number, number];
}

/** Statistics about a generated mosaic */
export interface MosaicStats {
  total_tiles: number;
  unique_tiles: number;
  avg_distance: number;
  min_distance: number;
  max_distance: number;
  columns: number;
  rows: number;
  most_used: TileUsage[];
  worst_matches: TileMatch[];
}

export type ErrorCode =
  | 'INSUFFICIENT_TILES'
  | 'MISSING_SOURCE_IMAGE'
  | 'MISSING_TILES'
  | 'GENERATION_FAILED'
  | 'UPLOAD_FAILED';

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
  stats_image_path?: string;
  stats?: MosaicStats;
  error_code?: ErrorCode;
  error_message?: string;
}

export interface Job {
  id: string;
  mosaic_id: string;
  status: 'pending' | 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  started_at: string;
  completed_at?: string;
  error_message?: string;
  error_code?: ErrorCode;
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
  tiles_dir?: string;
}

export interface SubmitJobRequest {
  mosaic_id: string;
}

// User management types
export interface User {
  username: string;
  email: string | null;
  status: 'UNCONFIRMED' | 'CONFIRMED' | 'ARCHIVED' | 'COMPROMISED' | 'UNKNOWN' | 'RESET_REQUIRED' | 'FORCE_CHANGE_PASSWORD';
  enabled: boolean;
  created: string | null;
  modified: string | null;
}

export interface UserListResponse {
  users: User[];
  count: number;
  userPoolId: string;
}

export interface UserActionResponse {
  success: boolean;
  username?: string;
  email?: string;
  status?: string;
  message?: string;
  error?: string;
}

// Tile folder types
export interface TileFolder {
  name: string;
  prefix: string;
}

export interface TileFoldersResponse {
  folders: TileFolder[];
  prefix: string;
  count: number;
}
