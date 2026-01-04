import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createMosaic, getUploadUrl, uploadFileToS3, submitJob, getTileCount, listTileFolders } from '../services/api';
import { createMosaicCreationLogger } from '../services/errorLogger';
import { useTranslation } from '../i18n';
import type { MosaicConfig, TileFolder } from '../types/api';

/**
 * Custom hook to debounce a value
 */
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

const BASE_TILE_SIZES = [16, 32, 48, 64, 96, 128, 192, 256];
const DOWNSAMPLE_OPTIONS = [1, 2, 4, 8, 16, 32, 64, 256];
const MODES = [
  { value: 1, label: '1 (1x1, single color match)', dim: 1 },
  { value: 2, label: '2 (2x2 grid matching)', dim: 2 },
  { value: 3, label: '3 (3x3 grid matching)', dim: 3 },
  { value: 4, label: '4 (4x4 grid matching)', dim: 4 },
  { value: 5, label: '5 (5x5 grid matching)', dim: 5 },
  { value: 6, label: '6 (6x6 grid matching)', dim: 6 },
  { value: 8, label: '8 (8x8 grid matching)', dim: 8 },
  { value: 16, label: '16 (16x16 grid matching)', dim: 16 },
  { value: 32, label: '32 (32x32 grid matching, best quality)', dim: 32 },
  { value: 0, label: 'Random (ignore source)', dim: 1 },
];

// Target output size in pixels (10 megapixels)
const TARGET_OUTPUT_PIXELS = 10_000_000;
// Maximum tiles allowed
const MAX_TILES = 40000;

/**
 * Calculate optimal mosaic settings for a given image.
 * Strategy:
 * 1. Prefer higher modes over downsampling for better quality
 * 2. Target ~10 megapixel output
 * 3. Keep tile count under MAX_TILES
 * 4. Enable no_repeat and crop by default
 */
function calculateOptimalSettings(
  dimensions: ImageDimensions
): Partial<MosaicConfig> {
  const { width, height } = dimensions;
  const imagePixels = width * height;

  // Try modes from highest to lowest (excluding random mode 0)
  const qualityModes = MODES.filter(m => m.value > 0).sort((a, b) => b.value - a.value);

  for (const modeConfig of qualityModes) {
    const mode = modeConfig.value;
    const dim = modeConfig.dim;

    // Get valid tile sizes for this mode, sorted largest to smallest
    const validTileSizes = getValidTileSizesForMode(mode).sort((a, b) => b - a);

    for (const downsample of DOWNSAMPLE_OPTIONS) {
      // Calculate downsampled dimensions
      const downsampledWidth = Math.floor(width / downsample);
      const downsampledHeight = Math.floor(height / downsample);

      // Adjust to multiples of dim
      const adjustedWidth = adjustToMultiple(downsampledWidth, dim);
      const adjustedHeight = adjustToMultiple(downsampledHeight, dim);

      // Calculate grid size (number of tiles)
      const columns = Math.floor(adjustedWidth / dim);
      const rows = Math.floor(adjustedHeight / dim);
      const totalTiles = columns * rows;

      // Skip if too many tiles
      if (totalTiles > MAX_TILES) continue;

      // Find the best tile size to get close to TARGET_OUTPUT_PIXELS
      for (const tileSize of validTileSizes) {
        const outputPixels = columns * tileSize * rows * tileSize;

        // Accept if output is within reasonable range (5M to 15M pixels)
        // or if this is the best we can do with this mode
        if (outputPixels <= TARGET_OUTPUT_PIXELS * 1.5 && outputPixels >= TARGET_OUTPUT_PIXELS * 0.5) {
          return {
            mode,
            tile_size: tileSize,
            downsample,
            no_repeat: true,
            crop: true,
          };
        }

        // If output is too small, try smaller tile sizes
        if (outputPixels > TARGET_OUTPUT_PIXELS * 1.5) {
          continue;
        }

        // If we've gone through all tile sizes and output is too small,
        // use the largest tile size that gives us reasonable output
        if (outputPixels < TARGET_OUTPUT_PIXELS * 0.5 && tileSize === validTileSizes[validTileSizes.length - 1]) {
          // Use the largest tile size for this mode/downsample combo
          const bestTileSize = validTileSizes[0];
          const bestOutput = columns * bestTileSize * rows * bestTileSize;
          if (bestOutput >= 1_000_000) { // At least 1 megapixel
            return {
              mode,
              tile_size: bestTileSize,
              downsample,
              no_repeat: true,
              crop: true,
            };
          }
        }
      }
    }
  }

  // Fallback: use conservative defaults
  // Calculate a reasonable downsample based on image size
  let downsample = 1;
  let effectivePixels = imagePixels;
  while (effectivePixels > TARGET_OUTPUT_PIXELS * 2 && downsample < 256) {
    downsample *= 2;
    effectivePixels = imagePixels / (downsample * downsample);
  }

  return {
    mode: 4,
    tile_size: 32,
    downsample,
    no_repeat: true,
    crop: true,
  };
}

/**
 * Get the grid dimension for a mode value.
 * Mode 0 (random) is treated as dim=1 for validation purposes.
 */
function getModeDim(mode: number): number {
  const modeConfig = MODES.find(m => m.value === mode);
  return modeConfig?.dim ?? 1;
}

/**
 * Check if a tile size is valid for a given mode.
 * Tile size must be divisible by the mode's grid dimension.
 */
function isTileSizeValidForMode(tileSize: number, mode: number): boolean {
  const dim = getModeDim(mode);
  return tileSize % dim === 0;
}

/**
 * Get valid tile sizes for a given mode.
 * Generates multiples of the mode's dimension, targeting reasonable sizes.
 */
function getValidTileSizesForMode(mode: number): number[] {
  const dim = getModeDim(mode);

  // First, filter base sizes that are valid
  const validBaseSizes = BASE_TILE_SIZES.filter(size => size % dim === 0);

  // If we have valid base sizes, use them
  if (validBaseSizes.length > 0) {
    return validBaseSizes;
  }

  // Otherwise, generate multiples of dim in a reasonable range (16-256)
  // But limit to practical sizes to avoid a huge dropdown
  const sizes: number[] = [];
  for (let mult = 1; mult * dim <= 256; mult++) {
    const size = mult * dim;
    if (size >= 16) {
      sizes.push(size);
    }
  }

  // If too many options, filter to nice round numbers
  if (sizes.length > 10) {
    const filteredSizes = sizes.filter(size =>
      size % 25 === 0 || size % 20 === 0 || size === sizes[0]
    );
    // Make sure we have at least a few options
    if (filteredSizes.length >= 3) {
      return filteredSizes;
    }
  }

  // If still empty (dim > 256), just use dim itself and multiples
  if (sizes.length === 0) {
    sizes.push(dim);
    if (dim * 2 <= 512) sizes.push(dim * 2);
  }

  return sizes;
}

/**
 * Find the closest valid tile size for a mode.
 */
function findClosestValidTileSize(currentSize: number, mode: number): number {
  const validSizes = getValidTileSizesForMode(mode);
  if (validSizes.length === 0) return 32; // Fallback default

  // Find the closest valid size
  let closest = validSizes[0];
  let minDiff = Math.abs(currentSize - closest);

  for (const size of validSizes) {
    const diff = Math.abs(currentSize - size);
    if (diff < minDiff) {
      minDiff = diff;
      closest = size;
    }
  }

  return closest;
}

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

/**
 * Get the relative path of a folder from the tiles prefix (used as exclusion key)
 */
function getFolderPath(folder: TileFolder, tilesPrefix: string): string {
  // Remove the tiles prefix and trailing slash to get relative path
  return folder.prefix.replace(tilesPrefix, '').replace(/\/$/, '');
}

/**
 * Collect all folder paths in a tree (including nested children)
 */
function collectAllFolderPaths(folders: TileFolder[], tilesPrefix: string): string[] {
  const paths: string[] = [];
  for (const folder of folders) {
    paths.push(getFolderPath(folder, tilesPrefix));
    if (folder.children) {
      paths.push(...collectAllFolderPaths(folder.children, tilesPrefix));
    }
  }
  return paths;
}

interface FolderTreeNodeProps {
  folder: TileFolder;
  tilesPrefix: string;
  excludedFolders: string[];
  expandedFolders: Set<string>;
  onToggleExclusion: (path: string, childPaths: string[]) => void;
  onToggleExpanded: (path: string) => void;
  depth: number;
}

function FolderTreeNode({
  folder,
  tilesPrefix,
  excludedFolders,
  expandedFolders,
  onToggleExclusion,
  onToggleExpanded,
  depth,
}: FolderTreeNodeProps) {
  const folderPath = getFolderPath(folder, tilesPrefix);
  const isExcluded = excludedFolders.includes(folderPath);
  const hasChildren = folder.children && folder.children.length > 0;
  const isExpanded = expandedFolders.has(folderPath);

  // Check if any children are excluded (for partial state indication)
  const childPaths = hasChildren ? collectAllFolderPaths(folder.children!, tilesPrefix) : [];
  const someChildrenExcluded = childPaths.some(p => excludedFolders.includes(p));
  const allChildrenExcluded = childPaths.length > 0 && childPaths.every(p => excludedFolders.includes(p));

  return (
    <div>
      <div
        className={`flex items-center py-1.5 cursor-pointer hover:bg-gray-50 ${
          isExcluded ? 'bg-gray-50' : ''
        }`}
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
      >
        {/* Expand/collapse button */}
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpanded(folderPath);
            }}
            className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 mr-1"
          >
            <svg
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <span className="w-6 mr-1" />
        )}

        {/* Checkbox */}
        <input
          type="checkbox"
          checked={!isExcluded}
          ref={(el) => {
            if (el) {
              el.indeterminate = !isExcluded && someChildrenExcluded && !allChildrenExcluded;
            }
          }}
          onChange={() => onToggleExclusion(folderPath, childPaths)}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          onClick={(e) => e.stopPropagation()}
        />

        {/* Folder icon */}
        <svg
          className={`w-4 h-4 ml-2 ${isExcluded ? 'text-gray-300' : 'text-yellow-500'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>

        {/* Folder name */}
        <span
          className={`ml-2 text-sm ${isExcluded ? 'text-gray-400' : 'text-gray-700'}`}
          onClick={() => onToggleExclusion(folderPath, childPaths)}
        >
          {folder.name}
        </span>

        {/* Child count badge */}
        {hasChildren && (
          <span className="ml-2 text-xs text-gray-400">
            ({folder.children!.length})
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {folder.children!.map((child) => (
            <FolderTreeNode
              key={child.prefix}
              folder={child}
              tilesPrefix={tilesPrefix}
              excludedFolders={excludedFolders}
              expandedFolders={expandedFolders}
              onToggleExclusion={onToggleExclusion}
              onToggleExpanded={onToggleExpanded}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CreateMosaic() {
  const navigate = useNavigate();
  const t = useTranslation();
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
    no_repeat: true,
    crop: true,
    downsample: 1,
    excluded_folders: [],
  });
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Fetch tile folders
  const { data: tileFoldersData, isLoading: foldersLoading } = useQuery({
    queryKey: ['tileFolders', tilesDir],
    queryFn: () => listTileFolders(tilesDir),
    enabled: !!tilesDir,
  });

  // Debounce excluded folders to avoid hammering the API on rapid folder selections
  const debouncedExcludedFolders = useDebounce(config.excluded_folders, 500);

  // Fetch tile count (with exclusions) - uses debounced value to reduce API calls
  const { data: tileCountData, isFetching: tileCountFetching } = useQuery({
    queryKey: ['tileCount', tilesDir, debouncedExcludedFolders],
    queryFn: () => getTileCount(tilesDir, debouncedExcludedFolders || []),
    enabled: !!tilesDir,
    // Keep previous data while refetching to prevent validation from disappearing
    placeholderData: (previousData) => previousData,
    // Increase stale time to reduce unnecessary refetches
    staleTime: 30000, // Consider data fresh for 30 seconds
    // Allow longer time for the query to complete (S3 listing can be slow)
    retry: 1, // Only retry once on failure
  });

  // Get valid tile sizes for the current mode
  const validTileSizes = useMemo(() => getValidTileSizesForMode(config.mode), [config.mode]);

  // Auto-adjust tile size when mode changes and current tile size is invalid
  useEffect(() => {
    if (!isTileSizeValidForMode(config.tile_size, config.mode)) {
      const newTileSize = findClosestValidTileSize(config.tile_size, config.mode);
      setConfig(prev => ({ ...prev, tile_size: newTileSize }));
    }
  }, [config.mode, config.tile_size]);

  // Tile size validation
  const tileSizeValidation = useMemo(() => {
    const dim = getModeDim(config.mode);
    if (!isTileSizeValidForMode(config.tile_size, config.mode)) {
      return {
        isValid: false,
        message: `Tile size ${config.tile_size} is not divisible by ${dim} (required for mode ${config.mode}). Valid sizes: ${validTileSizes.join(', ')}`,
      };
    }
    return { isValid: true, message: null };
  }, [config.tile_size, config.mode, validTileSizes]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(selectedFile);

      // Extract image dimensions and calculate optimal settings
      try {
        const dims = await getImageDimensions(selectedFile);
        setImageDimensions(dims);

        // Calculate and apply optimal settings for this image
        const optimalSettings = calculateOptimalSettings(dims);
        setConfig(prev => ({
          ...prev,
          ...optimalSettings,
          // Preserve user's excluded_folders and tint_opacity choices
          excluded_folders: prev.excluded_folders,
          tint_opacity: prev.tint_opacity,
        }));
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

      // Extract image dimensions and calculate optimal settings
      try {
        const dims = await getImageDimensions(droppedFile);
        setImageDimensions(dims);

        // Calculate and apply optimal settings for this image
        const optimalSettings = calculateOptimalSettings(dims);
        setConfig(prev => ({
          ...prev,
          ...optimalSettings,
          // Preserve user's excluded_folders and tint_opacity choices
          excluded_folders: prev.excluded_folders,
          tint_opacity: prev.tint_opacity,
        }));
      } catch {
        setImageDimensions(null);
      }
    }
  }, []);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');

      // Create error logger with mosaic creation context
      const errorLogger = createMosaicCreationLogger({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        config: config,
        imageDimensions: imageDimensions,
      });

      let s3Key: string | undefined;
      let mosaicId: string | undefined;

      try {
        // Step 1: Get presigned URL
        setUploadProgress(t.createMosaic.gettingUploadUrl);
        let upload_url: string;
        try {
          const urlResponse = await getUploadUrl(file.type, file.name);
          upload_url = urlResponse.upload_url;
          s3Key = urlResponse.s3_key;
        } catch (err) {
          await errorLogger.logStepError(
            'get_upload_url',
            'Failed to get presigned upload URL',
            err,
            { contentType: file.type }
          );
          throw err;
        }

        // Step 2: Upload file to S3
        setUploadProgress(t.createMosaic.uploadingImage);
        try {
          await uploadFileToS3(file, upload_url);
        } catch (err) {
          await errorLogger.logStepError(
            's3_upload',
            'Failed to upload image to S3',
            err,
            { s3Key }
          );
          throw err;
        }

        // Step 3: Create mosaic record
        setUploadProgress(t.createMosaic.creatingMosaic);
        let mosaic;
        try {
          mosaic = await createMosaic({
            title: title || undefined,
            source_image_path: s3Key,
            config,
            tiles_dir: tilesDir,
          });
          mosaicId = mosaic.id;
        } catch (err) {
          await errorLogger.logStepError(
            'create_mosaic',
            'Failed to create mosaic record',
            err,
            { s3Key, title }
          );
          throw err;
        }

        // Step 4: Submit job
        setUploadProgress(t.createMosaic.startingJob);
        let job;
        try {
          job = await submitJob(mosaic.id);
        } catch (err) {
          await errorLogger.logStepError(
            'submit_job',
            'Failed to submit mosaic generation job',
            err,
            { mosaicId, s3Key }
          );
          throw err;
        }

        return { mosaic, job };
      } catch (err) {
        // Log the overall failure if we haven't already logged a specific step error
        // This catches any unexpected errors not in the try/catch blocks above
        if (!s3Key && !mosaicId) {
          await errorLogger.logStepError(
            'unknown',
            'Unexpected error during mosaic creation',
            err
          );
        }
        throw err;
      }
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

  // Check if mosaic has too many tiles (max 40k for performance)
  const tileCountValidation = useMemo(() => {
    if (!mosaicStats) {
      return { isValid: true, message: null };
    }

    if (mosaicStats.totalTiles > MAX_TILES) {
      return {
        isValid: false,
        message: `Mosaic would require ${formatNumber(mosaicStats.totalTiles)} tiles, but the maximum is ${formatNumber(MAX_TILES)}. Increase downsample or use a smaller image.`
      };
    }

    return { isValid: true, message: null };
  }, [mosaicStats]);

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

  // Toggle folder exclusion (including all children)
  const toggleFolderExclusion = useCallback((folderPath: string, childPaths: string[]) => {
    setConfig(prev => {
      const excluded = prev.excluded_folders || [];
      const isCurrentlyExcluded = excluded.includes(folderPath);

      if (isCurrentlyExcluded) {
        // Including folder: remove it and all children from exclusion list
        const pathsToRemove = new Set([folderPath, ...childPaths]);
        return { ...prev, excluded_folders: excluded.filter(f => !pathsToRemove.has(f)) };
      } else {
        // Excluding folder: add it and all children to exclusion list
        const pathsToAdd = [folderPath, ...childPaths];
        const newExcluded = [...excluded];
        for (const path of pathsToAdd) {
          if (!newExcluded.includes(path)) {
            newExcluded.push(path);
          }
        }
        return { ...prev, excluded_folders: newExcluded };
      }
    });
  }, []);

  // Toggle folder expanded state
  const toggleFolderExpanded = useCallback((folderPath: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
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
        <h1 className="text-2xl font-bold text-gray-900">{t.createMosaic.title}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {t.createMosaic.subtitle}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* File Upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t.createMosaic.sourceImage}
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
                  {t.common.remove}
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
                  {t.createMosaic.clickOrDrag}
                </p>
                <p className="text-xs text-gray-500">{t.createMosaic.fileLimit}</p>
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
            {t.createMosaic.titleLabel}
          </label>
          <input
            type="text"
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
            placeholder={t.createMosaic.titlePlaceholder}
          />
        </div>

        {/* Tile Size */}
        <div>
          <label htmlFor="tile-size" className="block text-sm font-medium text-gray-700 mb-2">
            {t.createMosaic.tileSize}
          </label>
          <select
            id="tile-size"
            value={config.tile_size}
            onChange={(e) => setConfig({ ...config, tile_size: Number(e.target.value) })}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
          >
            {validTileSizes.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            {t.createMosaic.tileSizeHelp}
            {config.mode > 1 && (
              <span className="text-gray-400"> ({t.createMosaic.tileSizeDivisible.replace('{dim}', String(getModeDim(config.mode))).replace('{mode}', String(config.mode))})</span>
            )}
          </p>
        </div>

        {/* Downsample */}
        <div>
          <label htmlFor="downsample" className="block text-sm font-medium text-gray-700 mb-2">
            {t.createMosaic.downsample}
          </label>
          <select
            id="downsample"
            value={config.downsample ?? 1}
            onChange={(e) => setConfig({ ...config, downsample: Number(e.target.value) })}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
          >
            {DOWNSAMPLE_OPTIONS.map((factor) => (
              <option key={factor} value={factor}>
                {factor === 1 ? `1x (${t.createMosaic.noDownsampling})` : `${factor}x (${t.createMosaic.resolution.replace('{factor}', String(factor))})`}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            {t.createMosaic.downsampleHelp}
          </p>
        </div>

        {/* Mode */}
        <div>
          <label htmlFor="mode" className="block text-sm font-medium text-gray-700 mb-2">
            {t.createMosaic.matchingMode}
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
            {t.createMosaic.modeHelp}
          </p>
        </div>

        {/* Tint Opacity */}
        <div>
          <label htmlFor="opacity" className="block text-sm font-medium text-gray-700 mb-2">
            {t.createMosaic.tintOpacity}: {config.tint_opacity.toFixed(2)}
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
            {t.createMosaic.tintHelp}
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
              {t.createMosaic.noRepeat}
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
              {t.createMosaic.cropTiles}
            </label>
          </div>
        </div>

        {/* Tile Folders */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t.createMosaic.tileFolders}
            {tileFoldersData && (
              <span className="ml-2 text-gray-400 font-normal">
                ({includedFolderCount} {t.createMosaic.includedOf} {tileFoldersData.count} {t.createMosaic.included})
              </span>
            )}
          </label>
          {foldersLoading ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
              <span className="ml-2 text-sm text-gray-500">{t.createMosaic.loadingFolders}</span>
            </div>
          ) : tileFoldersData && tileFoldersData.folders.length > 0 ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="max-h-64 overflow-y-auto">
                {tileFoldersData.folders.map((folder) => (
                  <FolderTreeNode
                    key={folder.prefix}
                    folder={folder}
                    tilesPrefix={tilesDir}
                    excludedFolders={config.excluded_folders || []}
                    expandedFolders={expandedFolders}
                    onToggleExclusion={toggleFolderExclusion}
                    onToggleExpanded={toggleFolderExpanded}
                    depth={0}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t.createMosaic.noFolders}</p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            {t.createMosaic.uncheckFolders}
          </p>
        </div>

        {/* Mosaic Statistics */}
        {mosaicStats && imageDimensions && (
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-900 mb-3">
              {t.createMosaic.mosaicPreview}
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">{t.createMosaic.sourceImageLabel}</p>
                <p className="font-medium text-gray-900">
                  {formatNumber(imageDimensions.width)} x {formatNumber(imageDimensions.height)} px
                </p>
                {file && (
                  <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>
                )}
              </div>
              <div>
                <p className="text-gray-500">{t.createMosaic.outputSize}</p>
                <p className="font-medium text-gray-900">
                  {formatNumber(mosaicStats.outputWidth)} x {formatNumber(mosaicStats.outputHeight)} px
                </p>
              </div>
              <div>
                <p className="text-gray-500">{t.createMosaic.tilesPerRow}</p>
                <p className="font-medium text-gray-900">
                  {formatNumber(mosaicStats.columns)}
                </p>
              </div>
              <div>
                <p className="text-gray-500">{t.createMosaic.tilesPerColumn}</p>
                <p className="font-medium text-gray-900">
                  {formatNumber(mosaicStats.rows)}
                </p>
              </div>
              <div className="col-span-2 pt-2 border-t border-gray-200">
                <p className="text-gray-500">{t.createMosaic.totalTiles}</p>
                <p className="font-medium text-gray-900">
                  {formatNumber(mosaicStats.totalTiles)}
                  <span className="text-xs text-gray-400 ml-2">
                    ({formatNumber(mosaicStats.columns)} x {formatNumber(mosaicStats.rows)})
                  </span>
                </p>
              </div>
              {tileCountData && config.no_repeat && (
                <div className="col-span-2 pt-2 border-t border-gray-200">
                  <p className="text-gray-500">{t.createMosaic.availableTiles}</p>
                  <p className="font-medium text-gray-900">
                    {formatNumber(tileCountData.count)}
                    {tileCountFetching && (
                      <span className="ml-2 text-xs text-gray-400">({t.createMosaic.updating})</span>
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tile Size Validation Warning */}
        {!tileSizeValidation.isValid && (
          <div className="rounded-md bg-yellow-50 border border-yellow-200 p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">{t.createMosaic.invalidTileSize}</h3>
                <p className="mt-1 text-sm text-yellow-700">{tileSizeValidation.message}</p>
              </div>
            </div>
          </div>
        )}

        {/* Too Many Tiles Validation Warning */}
        {!tileCountValidation.isValid && (
          <div className="rounded-md bg-yellow-50 border border-yellow-200 p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">{t.createMosaic.tooManyTiles}</h3>
                <p className="mt-1 text-sm text-yellow-700">{tileCountValidation.message}</p>
              </div>
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
                <h3 className="text-sm font-medium text-yellow-800">{t.createMosaic.insufficientTiles}</h3>
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
                : t.createMosaic.failedToCreate}
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
            {t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={!file || createMutation.isPending || !noRepeatValidation.isValid || !tileSizeValidation.isValid || !tileCountValidation.isValid}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? t.createMosaic.creating : t.createMosaic.title}
          </button>
        </div>
      </form>
    </div>
  );
}
