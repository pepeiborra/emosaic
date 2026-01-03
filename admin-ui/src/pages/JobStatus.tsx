import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getJob, cancelJob } from '../services/api';
import { useTranslation } from '../i18n';
import type { Job } from '../types/api';

function StatusIcon({ status }: { status: Job['status'] }) {
  switch (status) {
    case 'pending':
    case 'submitted':
      return (
        <div className="h-16 w-16 rounded-full bg-yellow-100 flex items-center justify-center">
          <svg className="h-8 w-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      );
    case 'running':
      return (
        <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      );
    case 'succeeded':
      return (
        <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      );
    case 'failed':
      return (
        <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center">
          <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      );
    case 'cancelled':
      return (
        <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center">
          <svg className="h-8 w-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
      );
  }
}

function StatusText({ status }: { status: Job['status'] }) {
  const t = useTranslation();
  const statusKey = status as keyof typeof t.jobStatus.statuses;
  const statusData = t.jobStatus.statuses[statusKey];

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900">{statusData.title}</h2>
      <p className="text-sm text-gray-500 mt-1">{statusData.description}</p>
    </div>
  );
}

export function JobStatus() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const t = useTranslation();

  const { data: job, isLoading, error } = useQuery({
    queryKey: ['job', id],
    queryFn: () => getJob(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Poll every 3 seconds while pending, submitted, or running
      if (data?.status === 'pending' || data?.status === 'submitted' || data?.status === 'running') {
        return 3000;
      }
      return false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelJob(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', id] });
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto text-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
        <p className="text-gray-500 mt-4">{t.jobStatus.loadingJobStatus}</p>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-lg mx-auto text-center py-12">
        <p className="text-red-600">{t.jobStatus.failedToLoad}</p>
        <Link to="/" className="text-indigo-600 hover:text-indigo-700 mt-4 inline-block">
          {t.jobStatus.backToDashboard}
        </Link>
      </div>
    );
  }

  const duration = job.completed_at
    ? Math.round((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000)
    : Math.round((Date.now() - new Date(job.started_at).getTime()) / 1000);

  return (
    <div className="max-w-lg mx-auto">
      <Link to="/" className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-block">
        &larr; {t.jobStatus.backToDashboard}
      </Link>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <div className="flex justify-center mb-6">
          <StatusIcon status={job.status} />
        </div>

        <StatusText status={job.status} />

        <div className="mt-6 space-y-2 text-sm text-gray-500">
          <p>{t.jobStatus.jobId}: {job.id.slice(0, 8)}...</p>
          <p>{t.jobStatus.started}: {new Date(job.started_at).toLocaleString()}</p>
          {(job.status === 'running' || job.status === 'succeeded') && (
            <p>{t.jobStatus.durationLabel}: {duration}s</p>
          )}
        </div>

        {job.error_message && (
          <div className="mt-6 p-4 bg-red-50 rounded-lg">
            <p className="text-sm text-red-700">{job.error_message}</p>
          </div>
        )}

        <div className="mt-8 flex justify-center gap-4">
          {(job.status === 'pending' || job.status === 'submitted' || job.status === 'running') && (
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-300 rounded-md hover:bg-red-50 disabled:opacity-50"
            >
              {cancelMutation.isPending ? t.jobStatus.cancelling : t.jobStatus.cancelJob}
            </button>
          )}

          {job.status === 'succeeded' && (
            <Link
              to={`/mosaic/${job.mosaic_id}`}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
            >
              {t.jobStatus.viewMosaic}
            </Link>
          )}

          {(job.status === 'failed' || job.status === 'cancelled') && (
            <Link
              to={`/mosaic/${job.mosaic_id}`}
              className="px-4 py-2 text-sm font-medium text-indigo-600 bg-white border border-indigo-600 rounded-md hover:bg-indigo-50"
            >
              {t.jobStatus.backToMosaic}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
