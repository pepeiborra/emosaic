import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createMosaic, getUploadUrl, uploadFileToS3, submitJob, getTileCount, listTileFolders } from '../services/api';
import type { MosaicConfig } from '../types/api';

const TILE_SIZES = [16, 32, 64, 128, 256];
const DOWNSAMPLE_OPTIONS = [1, 2, 4, 8, 16, 32, 64, 256];
const MODES = [
  { value: 1, label: '1 (1x1, single color match)' },
  { value: 2, label: '2 (2x2 grid matching)' },
  { value: 3, label: '3 (3x3 grid matching)' },
  { value: 4, label: '4 (4x4 grid matching)' },
  { value: 5, label: '5 (5x5 grid matching)' },
  { value: 6, label: '6 (6x6 grid matching)' },
  { value: 8, label: '8 (8x8 grid matching)' },
  { value: 16, label: '16 (16x16 grid matching)' },
  { value: 32, label: '32 (32x32 grid matching, best quality)' },
  { value: 0, label: 'Random (ignore source)' },
];

interface ImageDimensions {
  width: number;
  height: number;
}

interface MosaicStats {
  columns: number;
  rows: number;
  totalTiles: number;
  outputWidth: number;
  outputHeight: number;
  adjustedWidth: number;
  adjustedHeight: number;
}

/**
 * Adjust a dimension to be a multiple of dim, using the same rounding logic as Rust.
 * Rust uses: if (mod > dim.div_euclid(2)) round up, else round down
 * This means ties (e.g., mod == dim/2) round DOWN, not up.
 */
function adjustToMultiple(value: number, dim: number): number {
  const mod = value % dim;
  const halfDim = Math.floor(dim / 2);
  if (mod > halfDim) {
    return value + (dim - mod); // round up
  } else {
    return value - mod; // round down
  }
}

/**
 * Calculate mosaic statistics based on image dimensions and config.
 * Mirrors the logic in src/main.rs n_to_1 function.
 */
function calculateMosaicStats(
  dimensions: ImageDimensions,
  mode: number,
  tileSize: number,
  downsample: number = 1
): MosaicStats {
  const { width, height } = dimensions;

  // Apply downsampling factor first (matches Rust logic)
  const downsampledWidth = Math.floor(width / downsample);
  const downsampledHeight = Math.floor(height / downsample);

  // dim = mode directly (mode specifies the grid dimension)
  // For random mode (0), treat as 1-to-1
  const dim = mode === 0 ? 1 : mode;

  // Adjust dimensions to be multiples of dim (matches Rust logic exactly)
  const adjustedWidth = adjustToMultiple(downsampledWidth, dim);
  const adjustedHeight = adjustToMultiple(downsampledHeight, dim);

  // Calculate grid size - number of tiles in each direction
  const columns = Math.floor(adjustedWidth / dim);
  const rows = Math.floor(adjustedHeight / dim);
  const totalTiles = columns * rows;

  // Calculate output dimensions
  const outputWidth = columns * tileSize;
  const outputHeight = rows * tileSize;

  return {
    columns,
    rows,
    totalTiles,
    outputWidth,
    outputHeight,
    adjustedWidth,
    adjustedHeight,
  };
}

/**
 * Get image dimensions from a File object
 */
function getImageDimensions(file: File): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Format a number with thousands separators
 */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Format bytes as human-readable size
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CreateMosaic() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<ImageDimensions | null>(null);
  const [title, setTitle] = useState('');
  // Hardcoded tiles directory - implementation detail
  const tilesDir = 'tiles/';
  const [config, setConfig] = useState<MosaicConfig>({
    tile_size: 32,
    mode: 4,
    tint_opacity: 0.3,
    no_repeat: false,
    crop: false,
    downsample: 1,
    excluded_folders: [],
  });
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // Fetch tile folders
  const { data: tileFoldersData, isLoading: foldersLoading } = useQuery({
    queryKey: ['tileFolders', tilesDir],
    queryFn: () => listTileFolders(tilesDir),
    enabled: !!tilesDir,
  });

  // Fetch tile count (with exclusions)
  const { data: tileCountData } = useQuery({
    queryKey: ['tileCount', tilesDir, config.excluded_folders],
    queryFn: () => getTileCount(tilesDir, config.excluded_folders || []),
    enabled: !!tilesDir,
  });

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(selectedFile);

      // Extract image dimensions
      try {
        const dims = await getImageDimensions(selectedFile);
        setImageDimensions(dims);
      } catch {
        setImageDimensions(null);
      }
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('image/')) {
      setFile(droppedFile);
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(droppedFile);

      // Extract image dimensions
      try {
        const dims = await getImageDimensions(droppedFile);
        setImageDimensions(dims);
      } catch {
        setImageDimensions(null);
      }
    }
  }, []);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');

      // Step 1: Get presigned URL
      setUploadProgress('Getting upload URL...');
      const { upload_url, s3_key } = await getUploadUrl(file.type, file.name);

      // Step 2: Upload file to S3
      setUploadProgress('Uploading image...');
      await uploadFileToS3(file, upload_url);

      // Step 3: Create mosaic record
      setUploadProgress('Creating mosaic...');
      const mosaic = await createMosaic({
        title: title || undefined,
        source_image_path: s3_key,
        config,
        tiles_dir: tilesDir,
      });

      // Step 4: Submit job
      setUploadProgress('Starting generation job...');
      const job = await submitJob(mosaic.id);

      return { mosaic, job };
    },
    onSuccess: ({ job }) => {
      navigate(`/job/${job.id}`);
    },
    onError: () => {
      setUploadProgress(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate();
  };

  // Calculate mosaic statistics when image and config are available
  const mosaicStats = useMemo(() => {
    if (!imageDimensions) return null;
    return calculateMosaicStats(imageDimensions, config.mode, config.tile_size, config.downsample ?? 1);
  }, [imageDimensions, config.mode, config.tile_size, config.downsample]);

  // Check if no-repeat mode requires more tiles than available
  const noRepeatValidation = useMemo(() => {
    if (!config.no_repeat || !mosaicStats || !tileCountData) {
      return { isValid: true, message: null };
    }

    const requiredTiles = mosaicStats.totalTiles;
    const availableTiles = tileCountData.count;

    if (availableTiles < requiredTiles) {
      return {
        isValid: false,
        message: `No-repeat mode requires ${formatNumber(requiredTiles)} tiles, but only ${formatNumber(availableTiles)} are available. Either reduce image size, increase downsample, or disable no-repeat.`
      };
    }

    return { isValid: true, message: null };
  }, [config.no_repeat, mosaicStats, tileCountData]);

  // Toggle folder exclusion
  const toggleFolderExclusion = useCallback((folderName: string) => {
    setConfig(prev => {
      const excluded = prev.excluded_folders || [];
      if (excluded.includes(folderName)) {
        return { ...prev, excluded_folders: excluded.filter(f => f !== folderName) };
      } else {
        return { ...prev, excluded_folders: [...excluded, folderName] };
      }
    });
  }, []);

  // Calculate included folder count
  const includedFolderCount = useMemo(() => {
    if (!tileFoldersData) return 0;
    const excludedCount = config.excluded_folders?.length || 0;
    return tileFoldersData.count - excludedCount;
  }, [tileFoldersData, config.excluded_folders]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Create Mosaic</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload a source image and configure mosaic generation settings.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* File Upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Source Image
          </label>
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              preview ? 'border-indigo-300 bg-indigo-50' : 'border-gray-300 hover:border-gray-400'
            }`}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            {preview ? (
              <div className="space-y-4">
                <img
                  src={preview}
                  alt="Preview"
                  className="max-h-64 mx-auto rounded-lg shadow-sm"
                />
                <p className="text-sm text-gray-600">{file?.name}</p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setPreview(null);
                    setImageDimensions(null);
                  }}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <p className="text-sm text-gray-600">
                  Click or drag and drop to upload
                </p>
                <p className="text-xs text-gray-500">PNG, JPG up to 20MB</p>
              </div>
            )}
          </div>
          <input
            id="file-input"
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Title */}
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
            Title (optional)
          </label>
          <input
            type="text"
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
            placeholder="My Mosaic"
          />
        </div>

        {/* Tile Size */}
        <div>
          <label htmlFor="tile-size" className="block text-sm font-medium text-gray-700 mb-2">
            Tile Size
          </label>
          <select
            id="tile-size"
            value={config.tile_size}
            onChange={(e) => setConfig({ ...config, tile_size: Number(e.target.value) })}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
          >
            {TILE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Smaller tiles = more detail but larger output
          </p>
        </div>

        {/* Downsample */}
        <div>
          <label htmlFor="downsample" className="block text-sm font-medium text-gray-700 mb-2">
            Downsample Factor
          </label>
          <select
            id="downsample"
            value={config.downsample ?? 1}
            onChange={(e) => setConfig({ ...config, downsample: Number(e.target.value) })}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
          >
            {DOWNSAMPLE_OPTIONS.map((factor) => (
              <option key={factor} value={factor}>
                {factor === 1 ? '1× (no downsampling)' : `${factor}× (1/${factor} resolution)`}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Higher values reduce output size and processing time
          </p>
        </div>

        {/* Mode */}
        <div>
          <label htmlFor="mode" className="block text-sm font-medium text-gray-700 mb-2">
            Matching Mode
          </label>
          <select
            id="mode"
            value={config.mode}
            onChange={(e) => setConfig({ ...config, mode: Number(e.target.value) })}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
          >
            {MODES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Higher values analyze more segments per tile for better matching
          </p>
        </div>

        {/* Tint Opacity */}
        <div>
          <label htmlFor="opacity" className="block text-sm font-medium text-gray-700 mb-2">
            Tint Opacity: {config.tint_opacity.toFixed(2)}
          </label>
          <input
            type="range"
            id="opacity"
            min="0"
            max="1"
            step="0.05"
            value={config.tint_opacity}
            onChange={(e) => setConfig({ ...config, tint_opacity: Number(e.target.value) })}
            className="block w-full"
          />
          <p className="mt-1 text-xs text-gray-500">
            Higher values blend the source image more visibly
          </p>
        </div>

        {/* Checkboxes */}
        <div className="space-y-4">
          <div className="flex items-center">
            <input
              id="no-repeat"
              type="checkbox"
              checked={config.no_repeat}
              onChange={(e) => setConfig({ ...config, no_repeat: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="no-repeat" className="ml-2 block text-sm text-gray-700">
              No repeat tiles (uses Hungarian algorithm)
            </label>
          </div>
          <div className="flex items-center">
            <input
              id="crop"
              type="checkbox"
              checked={config.crop}
              onChange={(e) => setConfig({ ...config, crop: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="crop" className="ml-2 block text-sm text-gray-700">
              Crop tiles to square (instead of resize)
            </label>
          </div>
        </div>

        {/* Tile Folders */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tile Folders
            {tileFoldersData && (
              <span className="ml-2 text-gray-400 font-normal">
                ({includedFolderCount} of {tileFoldersData.count} included)
              </span>
            )}
          </label>
          {foldersLoading ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
              <span className="ml-2 text-sm text-gray-500">Loading folders...</span>
            </div>
          ) : tileFoldersData && tileFoldersData.folders.length > 0 ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="max-h-48 overflow-y-auto">
                {tileFoldersData.folders.map((folder) => {
                  const isExcluded = config.excluded_folders?.includes(folder.name) || false;
                  return (
                    <div
                      key={folder.name}
                      className={`flex items-center px-3 py-2 border-b border-gray-100 last:border-b-0 cursor-pointer hover:bg-gray-50 ${
                        isExcluded ? 'bg-gray-50' : ''
                      }`}
                      onClick={() => toggleFolderExclusion(folder.name)}
                    >
                      <input
                        type="checkbox"
                        checked={!isExcluded}
                        onChange={() => toggleFolderExclusion(folder.name)}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className={`ml-2 text-sm ${isExcluded ? 'text-gray-400' : 'text-gray-700'}`}>
                        {folder.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No folders found in tiles directory</p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            Uncheck folders to exclude them from mosaic generation
          </p>
        </div>

        {/* Mosaic Statistics */}
        {mosaicStats && imageDimensions && (
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-900 mb-3">
              Mosaic Preview
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Source Image</p>
                <p className="font-medium text-gray-900">
                  {formatNumber(imageDimensions.width)} × {formatNumber(imageDimensions.height)} px
                </p>
                {file && (
                  <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>
                )}
              </div>
              <div>
                <p className="text-gray-500">Output Size</p>
                <p className="font-medium text-gray-900">
                  {formatNumber(mosaicStats.outputWidth)} × {formatNumber(mosaicStats.outputHeight)} px
                </p>
              </div>
              <div>
                <p className="text-gray-500">Tiles per Row</p>
                <p className="font-medium text-gray-900">
                  {formatNumber(mosaicStats.columns)}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Tiles per Column</p>
                <p className="font-medium text-gray-900">
                  {formatNumber(mosaicStats.rows)}
                </p>
              </div>
              <div className="col-span-2 pt-2 border-t border-gray-200">
                <p className="text-gray-500">Total Tiles</p>
                <p className="font-medium text-gray-900">
                  {formatNumber(mosaicStats.totalTiles)}
                  <span className="text-xs text-gray-400 ml-2">
                    ({formatNumber(mosaicStats.columns)} × {formatNumber(mosaicStats.rows)})
                  </span>
                </p>
              </div>
              {tileCountData && config.no_repeat && (
                <div className="col-span-2 pt-2 border-t border-gray-200">
                  <p className="text-gray-500">Available Tiles</p>
                  <p className="font-medium text-gray-900">
                    {formatNumber(tileCountData.count)}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* No-Repeat Validation Warning */}
        {!noRepeatValidation.isValid && (
          <div className="rounded-md bg-yellow-50 border border-yellow-200 p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">Insufficient tiles for no-repeat mode</h3>
                <p className="mt-1 text-sm text-yellow-700">{noRepeatValidation.message}</p>
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {createMutation.error && (
          <div className="rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-700">
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : 'Failed to create mosaic'}
            </p>
          </div>
        )}

        {/* Progress */}
        {uploadProgress && (
          <div className="rounded-md bg-blue-50 p-4">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-3"></div>
              <p className="text-sm text-blue-700">{uploadProgress}</p>
            </div>
          </div>
        )}

        {/* Submit */}
        <div className="flex justify-end gap-4">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!file || createMutation.isPending || !noRepeatValidation.isValid}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Mosaic'}
          </button>
        </div>
      </form>
    </div>
  );
}
