import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMosaic, deleteMosaic, setMainMosaic, submitJob } from '../services/api';
import type { Mosaic, Job, MosaicStats, ErrorCode } from '../types/api';

function StatusBadge({ status }: { status: Mosaic['status'] | Job['status'] }) {
  const styles: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    processing: 'bg-blue-100 text-blue-800',
    running: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    succeeded: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100'}`}>
      {status}
    </span>
  );
}

function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  isLoading = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  isLoading?: boolean;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={onClose} />
        <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
          <p className="text-sm text-gray-500 mb-6">{message}</p>
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
            >
              {isLoading ? 'Deleting...' : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Format a number with thousands separators and optional decimal places
 */
function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Get a color class based on distance quality (lower is better)
 */
function getDistanceColor(distance: number, maxDistance: number): string {
  const normalized = maxDistance > 0 ? distance / maxDistance : 0;
  if (normalized < 0.2) return 'text-green-600';
  if (normalized < 0.4) return 'text-lime-600';
  if (normalized < 0.6) return 'text-yellow-600';
  if (normalized < 0.8) return 'text-orange-600';
  return 'text-red-600';
}

/**
 * Get a user-friendly error message based on error code
 */
function getErrorDetails(errorCode?: ErrorCode, errorMessage?: string): { title: string; description: string; suggestion: string } {
  if (!errorCode) {
    return {
      title: 'Generation Failed',
      description: errorMessage || 'An unknown error occurred during mosaic generation.',
      suggestion: 'Check the job logs for more details or try regenerating the mosaic.',
    };
  }

  switch (errorCode) {
    case 'INSUFFICIENT_TILES':
      return {
        title: 'Insufficient Tiles',
        description: errorMessage || 'The mosaic requires more unique tile images than are currently available.',
        suggestion: 'Upload more tile images to the tile collection, reduce the mosaic size, or disable the "no-repeat" option to allow tile reuse.',
      };
    case 'MISSING_SOURCE_IMAGE':
      return {
        title: 'Source Image Not Found',
        description: errorMessage || 'The source image could not be found or downloaded.',
        suggestion: 'Verify that the source image was uploaded correctly and try regenerating the mosaic.',
      };
    case 'MISSING_TILES':
      return {
        title: 'No Tiles Available',
        description: errorMessage || 'No tile images were found in the tile collection.',
        suggestion: 'Upload tile images to the tile collection before generating a mosaic.',
      };
    case 'GENERATION_FAILED':
      return {
        title: 'Generation Failed',
        description: errorMessage || 'The mosaic generation process encountered an error.',
        suggestion: 'Check the CloudWatch logs for detailed error information or try regenerating with different settings.',
      };
    case 'UPLOAD_FAILED':
      return {
        title: 'Upload Failed',
        description: errorMessage || 'The generated mosaic could not be uploaded to storage.',
        suggestion: 'Check S3 permissions and try regenerating the mosaic.',
      };
    default:
      return {
        title: 'Unknown Error',
        description: errorMessage || 'An unexpected error occurred.',
        suggestion: 'Try regenerating the mosaic or contact support if the issue persists.',
      };
  }
}

/**
 * Stats overview component
 */
function StatsOverview({ stats }: { stats: MosaicStats }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Generation Statistics</h2>

      {/* Overview Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{formatNumber(stats.total_tiles)}</div>
          <div className="text-sm text-gray-500">Total Tiles</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{formatNumber(stats.unique_tiles)}</div>
          <div className="text-sm text-gray-500">Unique Images</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{stats.columns} × {stats.rows}</div>
          <div className="text-sm text-gray-500">Grid Size</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">
            {stats.unique_tiles > 0 ? ((stats.unique_tiles / stats.total_tiles) * 100).toFixed(1) : 0}%
          </div>
          <div className="text-sm text-gray-500">Tile Diversity</div>
        </div>
      </div>

      {/* Color Distance Stats */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Color Matching Quality</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="border border-green-200 bg-green-50 rounded-lg p-3">
            <div className="text-lg font-semibold text-green-700">{formatNumber(stats.min_distance, 2)}</div>
            <div className="text-xs text-green-600">Best Match</div>
          </div>
          <div className="border border-yellow-200 bg-yellow-50 rounded-lg p-3">
            <div className="text-lg font-semibold text-yellow-700">{formatNumber(stats.avg_distance, 2)}</div>
            <div className="text-xs text-yellow-600">Average</div>
          </div>
          <div className="border border-red-200 bg-red-50 rounded-lg p-3">
            <div className="text-lg font-semibold text-red-700">{formatNumber(stats.max_distance, 2)}</div>
            <div className="text-xs text-red-600">Worst Match</div>
          </div>
        </div>
      </div>

      {/* Most Used and Worst Matches */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Most Used Tiles */}
        {stats.most_used.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Most Used Tiles</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {stats.most_used.map((tile, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-2">
                  <span className="text-gray-600 truncate flex-1 mr-2" title={tile.path}>
                    {tile.path.split('/').pop()}
                  </span>
                  <span className="text-gray-900 font-medium whitespace-nowrap">
                    {tile.count}×
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Worst Matches */}
        {stats.worst_matches.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Worst Color Matches</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {stats.worst_matches.map((match, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-2">
                  <span className="text-gray-600 truncate flex-1 mr-2" title={match.path}>
                    {match.path.split('/').pop()}
                  </span>
                  <span className={`font-medium whitespace-nowrap ${getDistanceColor(match.distance, stats.max_distance)}`}>
                    {formatNumber(match.distance, 2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MosaicDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const { data: mosaic, isLoading, error } = useQuery({
    queryKey: ['mosaic', id],
    queryFn: () => getMosaic(id!, true),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Refetch every 5 seconds if processing
      return data?.status === 'processing' ? 5000 : false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMosaic(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mosaics'] });
      navigate('/');
    },
  });

  const setMainMutation = useMutation({
    mutationFn: () => setMainMosaic(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mosaic', id] });
      queryClient.invalidateQueries({ queryKey: ['mosaics'] });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () => submitJob(id!, mosaic?.is_main ?? false),
    onSuccess: (job) => {
      navigate(`/job/${job.id}`);
    },
  });

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-64 bg-gray-200 rounded mb-4" />
        <div className="h-4 bg-gray-200 rounded w-1/2" />
      </div>
    );
  }

  if (error || !mosaic) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Failed to load mosaic</p>
        <Link to="/" className="text-indigo-600 hover:text-indigo-700 mt-4 inline-block">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const mosaicUrl = mosaic.s3_path
    ? `/${mosaic.s3_path}`
    : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link to="/" className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            {mosaic.title || `Mosaic ${mosaic.id.slice(0, 8)}`}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {mosaic.is_main && (
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-indigo-100 text-indigo-800">
              Main Mosaic
            </span>
          )}
          <StatusBadge status={mosaic.status} />
        </div>
      </div>

      {/* Mosaic Image */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-6">
        {mosaic.status === 'completed' && mosaicUrl ? (
          <img
            src={mosaicUrl}
            alt={mosaic.title || 'Mosaic'}
            className="w-full h-auto"
          />
        ) : mosaic.status === 'processing' ? (
          <div className="h-64 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
              <p className="text-gray-500">Generating mosaic...</p>
            </div>
          </div>
        ) : mosaic.status === 'failed' ? (
          <div className="p-6 bg-red-50 border-l-4 border-red-400">
            {(() => {
              const { title, description, suggestion } = getErrorDetails(mosaic.error_code, mosaic.error_message);
              return (
                <>
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3 flex-1">
                      <h3 className="text-sm font-medium text-red-800">{title}</h3>
                      <div className="mt-2 text-sm text-red-700">
                        <p>{description}</p>
                      </div>
                      {mosaic.error_code && (
                        <div className="mt-2 text-xs text-red-600 font-mono bg-red-100 px-2 py-1 rounded inline-block">
                          Error Code: {mosaic.error_code}
                        </div>
                      )}
                      <div className="mt-4">
                        <p className="text-sm text-red-700">
                          <strong>Suggestion:</strong> {suggestion}
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        ) : (
          <div className="h-64 flex items-center justify-center bg-gray-50">
            <p className="text-gray-500">Pending generation</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 mb-8">
        {!mosaic.is_main && mosaic.status === 'completed' && (
          <button
            onClick={() => setMainMutation.mutate()}
            disabled={setMainMutation.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {setMainMutation.isPending ? 'Setting...' : 'Set as Main'}
          </button>
        )}
        <button
          onClick={() => regenerateMutation.mutate()}
          disabled={regenerateMutation.isPending || mosaic.status === 'processing'}
          className="px-4 py-2 text-sm font-medium text-indigo-600 bg-white border border-indigo-600 rounded-md hover:bg-indigo-50 disabled:opacity-50"
        >
          {regenerateMutation.isPending ? 'Starting...' : 'Regenerate'}
        </button>
        {mosaic.status === 'completed' && mosaicUrl && (
          <a
            href={mosaicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            View Full Size
          </a>
        )}
        {mosaic.status === 'completed' && (
          <a
            href={`/mosaics/${mosaic.id}/mosaic_widget.html`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700"
          >
            Open Mosaic Viewer
          </a>
        )}
        <button
          onClick={() => setShowDeleteModal(true)}
          className="px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-300 rounded-md hover:bg-red-50"
        >
          Delete
        </button>
      </div>

      {/* Details */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Details</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <dt className="text-sm font-medium text-gray-500">Created</dt>
            <dd className="text-sm text-gray-900">{new Date(mosaic.created_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Tile Size</dt>
            <dd className="text-sm text-gray-900">{mosaic.config.tile_size}px</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Mode</dt>
            <dd className="text-sm text-gray-900">{mosaic.config.mode}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Tint Opacity</dt>
            <dd className="text-sm text-gray-900">{mosaic.config.tint_opacity}</dd>
          </div>
          {mosaic.config.no_repeat && (
            <div>
              <dt className="text-sm font-medium text-gray-500">No Repeat</dt>
              <dd className="text-sm text-gray-900">Yes</dd>
            </div>
          )}
          {mosaic.config.crop && (
            <div>
              <dt className="text-sm font-medium text-gray-500">Crop Tiles</dt>
              <dd className="text-sm text-gray-900">Yes</dd>
            </div>
          )}
          {mosaic.config.downsample && mosaic.config.downsample > 1 && (
            <div>
              <dt className="text-sm font-medium text-gray-500">Downsample</dt>
              <dd className="text-sm text-gray-900">{mosaic.config.downsample}×</dd>
            </div>
          )}
          {mosaic.config.randomize !== undefined && mosaic.config.randomize > 0 && (
            <div>
              <dt className="text-sm font-medium text-gray-500">Randomize</dt>
              <dd className="text-sm text-gray-900">{mosaic.config.randomize}%</dd>
            </div>
          )}
          {mosaic.config.excluded_folders && mosaic.config.excluded_folders.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="text-sm font-medium text-gray-500">Excluded Folders</dt>
              <dd className="text-sm text-gray-900 mt-1">
                <div className="flex flex-wrap gap-1">
                  {mosaic.config.excluded_folders.map((folder) => (
                    <span
                      key={folder}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700"
                    >
                      {folder}
                    </span>
                  ))}
                </div>
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Stats Overview - only show if stats available */}
      {mosaic.stats && <StatsOverview stats={mosaic.stats} />}

      {/* Stats Image - Distance Visualization */}
      {mosaic.status === 'completed' && mosaic.stats_image_path && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Distance Visualization</h2>
          <p className="text-sm text-gray-500 mb-4">
            Grayscale heatmap showing tile matching quality. Darker areas indicate better color matches,
            lighter areas indicate tiles that differ more from the source image.
          </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <img
              src={`/${mosaic.stats_image_path}`}
              alt="Distance visualization"
              className="w-full h-auto"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
        </div>
      )}

      {/* Job History */}
      {mosaic.jobs && mosaic.jobs.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Job History</h2>
          <div className="space-y-3">
            {mosaic.jobs.map((job: Job) => (
              <Link
                key={job.id}
                to={`/job/${job.id}`}
                className="block p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={job.status} />
                    <span className="text-sm text-gray-600">
                      {new Date(job.started_at).toLocaleString()}
                    </span>
                  </div>
                  {job.completed_at && (
                    <span className="text-xs text-gray-500">
                      Duration: {Math.round((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000)}s
                    </span>
                  )}
                </div>
                {job.error_message && (
                  <div className="mt-2">
                    {job.error_code && (
                      <div className="text-xs text-red-600 font-mono bg-red-50 px-2 py-1 rounded inline-block mb-1">
                        {job.error_code}
                      </div>
                    )}
                    <p className="text-sm text-red-600">{job.error_message}</p>
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete Mosaic"
        message="Are you sure you want to delete this mosaic? This action cannot be undone."
        confirmText="Delete"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
