import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMosaic, deleteMosaic, setMainMosaic, submitJob } from '../services/api';
import type { Mosaic, Job } from '../types/api';

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
    mutationFn: () => submitJob(id!),
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
    ? `${import.meta.env.VITE_API_URL?.replace('/prod', '')}/tiles/${mosaic.s3_path}`
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
          <div className="h-64 flex items-center justify-center bg-red-50">
            <p className="text-red-600">Generation failed</p>
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
        </dl>
      </div>

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
                  <p className="text-sm text-red-600 mt-2">{job.error_message}</p>
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
