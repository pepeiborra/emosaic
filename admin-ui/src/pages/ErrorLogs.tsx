import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listErrors, type ErrorLogEntry } from '../services/api';
import { useTranslation } from '../i18n';

/**
 * Format a timestamp for display
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Get severity badge color
 */
function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'error':
      return 'bg-red-100 text-red-800';
    case 'warning':
      return 'bg-yellow-100 text-yellow-800';
    case 'info':
      return 'bg-blue-100 text-blue-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

/**
 * Get category badge color
 */
function getCategoryColor(category: string): string {
  switch (category) {
    case 'mosaic_creation':
      return 'bg-purple-100 text-purple-800';
    case 'image_upload':
      return 'bg-green-100 text-green-800';
    case 'api_request':
      return 'bg-blue-100 text-blue-800';
    case 'authentication':
      return 'bg-orange-100 text-orange-800';
    case 'file_processing':
      return 'bg-teal-100 text-teal-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

interface ErrorDetailModalProps {
  error: ErrorLogEntry;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>;
}

function ErrorDetailModal({ error, onClose, t }: ErrorDetailModalProps) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-end justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full sm:p-6">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                {t.errorLogs.errorDetails}
              </h3>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Header info */}
              <div className="flex flex-wrap gap-2">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getSeverityColor(error.severity)}`}>
                  {t.errorLogs.severities[error.severity as keyof typeof t.errorLogs.severities] || error.severity}
                </span>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(error.category)}`}>
                  {t.errorLogs.categories[error.category as keyof typeof t.errorLogs.categories] || error.category}
                </span>
                {error.step && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                    {error.step}
                  </span>
                )}
              </div>

              {/* Message */}
              <div>
                <h4 className="text-sm font-medium text-gray-500">{t.errorLogs.message}</h4>
                <p className="mt-1 text-sm text-gray-900">{error.message}</p>
              </div>

              {/* Original error */}
              {error.original_error && (
                <div>
                  <h4 className="text-sm font-medium text-gray-500">{t.errorLogs.originalError}</h4>
                  <p className="mt-1 text-sm text-red-600 font-mono bg-red-50 p-2 rounded">
                    {error.original_error}
                  </p>
                </div>
              )}

              {/* Timestamps */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-500">{t.errorLogs.clientTimestamp}</h4>
                  <p className="mt-1 text-sm text-gray-900">{formatTimestamp(error.client_timestamp)}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-500">{t.errorLogs.serverTimestamp}</h4>
                  <p className="mt-1 text-sm text-gray-900">{formatTimestamp(error.server_timestamp)}</p>
                </div>
              </div>

              {/* User info */}
              {error.user_email && (
                <div>
                  <h4 className="text-sm font-medium text-gray-500">{t.errorLogs.user}</h4>
                  <p className="mt-1 text-sm text-gray-900">{error.user_email}</p>
                </div>
              )}

              {/* URL */}
              {error.url && (
                <div>
                  <h4 className="text-sm font-medium text-gray-500">{t.errorLogs.url}</h4>
                  <p className="mt-1 text-sm text-gray-900 font-mono break-all">{error.url}</p>
                </div>
              )}

              {/* Context */}
              {error.context && Object.keys(error.context).length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-500">{t.errorLogs.context}</h4>
                  <pre className="mt-1 text-xs text-gray-900 font-mono bg-gray-50 p-3 rounded overflow-x-auto max-h-48">
                    {JSON.stringify(error.context, null, 2)}
                  </pre>
                </div>
              )}

              {/* Stack trace */}
              {error.stack && (
                <div>
                  <h4 className="text-sm font-medium text-gray-500">{t.errorLogs.stackTrace}</h4>
                  <pre className="mt-1 text-xs text-gray-700 font-mono bg-gray-50 p-3 rounded overflow-x-auto max-h-48">
                    {error.stack}
                  </pre>
                </div>
              )}

              {/* User agent */}
              {error.user_agent && (
                <div>
                  <h4 className="text-sm font-medium text-gray-500">{t.errorLogs.userAgent}</h4>
                  <p className="mt-1 text-xs text-gray-600 font-mono break-all">{error.user_agent}</p>
                </div>
              )}
            </div>

            <div className="mt-6">
              <button
                type="button"
                onClick={onClose}
                className="w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:text-sm"
              >
                {t.errorLogs.close}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ErrorLogs() {
  const t = useTranslation();
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [selectedError, setSelectedError] = useState<ErrorLogEntry | null>(null);
  const [lastKey, setLastKey] = useState<string | undefined>();

  // Available categories and severities for filters
  const categories = ['mosaic_creation', 'image_upload', 'api_request', 'authentication', 'file_processing', 'unknown'];
  const severities = ['error', 'warning', 'info'];

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['errorLogs', categoryFilter, severityFilter],
    queryFn: () => listErrors({
      limit: 50,
      category: categoryFilter || undefined,
      severity: severityFilter || undefined,
    }),
  });

  // Load more with pagination
  const { data: moreData, isFetching: isLoadingMore, refetch: loadMore } = useQuery({
    queryKey: ['errorLogsMore', categoryFilter, severityFilter, lastKey],
    queryFn: () => listErrors({
      limit: 50,
      category: categoryFilter || undefined,
      severity: severityFilter || undefined,
      lastKey,
    }),
    enabled: !!lastKey,
  });

  // Combine initial and paginated data
  const allErrors = useMemo(() => {
    const errors = data?.errors || [];
    if (moreData?.errors) {
      return [...errors, ...moreData.errors];
    }
    return errors;
  }, [data, moreData]);

  const handleLoadMore = () => {
    if (data?.lastKey) {
      setLastKey(data.lastKey);
      loadMore();
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t.errorLogs.title}</h1>
        <p className="mt-1 text-sm text-gray-500">{t.errorLogs.subtitle}</p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-4 items-center">
        <div>
          <label htmlFor="category-filter" className="sr-only">
            {t.errorLogs.filterByCategory}
          </label>
          <select
            id="category-filter"
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setLastKey(undefined);
            }}
            className="block rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
          >
            <option value="">{t.errorLogs.allCategories}</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {t.errorLogs.categories[cat as keyof typeof t.errorLogs.categories] || cat}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="severity-filter" className="sr-only">
            {t.errorLogs.filterBySeverity}
          </label>
          <select
            id="severity-filter"
            value={severityFilter}
            onChange={(e) => {
              setSeverityFilter(e.target.value);
              setLastKey(undefined);
            }}
            className="block rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
          >
            <option value="">{t.errorLogs.allSeverities}</option>
            {severities.map((sev) => (
              <option key={sev} value={sev}>
                {t.errorLogs.severities[sev as keyof typeof t.errorLogs.severities] || sev}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          <svg className={`-ml-0.5 mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {isFetching ? t.errorLogs.refreshing : t.errorLogs.refresh}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-md bg-red-50 p-4 mb-6">
          <p className="text-sm text-red-700">
            {t.errorLogs.failedToLoad}: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <span className="ml-3 text-sm text-gray-500">{t.errorLogs.loading}</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && allErrors.length === 0 && (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">{t.errorLogs.noErrors}</h3>
          <p className="mt-1 text-sm text-gray-500">{t.errorLogs.noErrorsDescription}</p>
        </div>
      )}

      {/* Error logs table */}
      {!isLoading && allErrors.length > 0 && (
        <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-lg">
          <table className="min-w-full divide-y divide-gray-300">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                  {t.errorLogs.timestamp}
                </th>
                <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  {t.errorLogs.severity}
                </th>
                <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  {t.errorLogs.category}
                </th>
                <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  {t.errorLogs.message}
                </th>
                <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  {t.errorLogs.user}
                </th>
                <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                  <span className="sr-only">{t.errorLogs.details}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {allErrors.map((errorLog) => (
                <tr key={errorLog.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm sm:pl-6">
                    <div className="text-gray-900">{formatRelativeTime(errorLog.server_timestamp)}</div>
                    <div className="text-gray-500 text-xs">{formatTimestamp(errorLog.server_timestamp)}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getSeverityColor(errorLog.severity)}`}>
                      {t.errorLogs.severities[errorLog.severity as keyof typeof t.errorLogs.severities] || errorLog.severity}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(errorLog.category)}`}>
                      {t.errorLogs.categories[errorLog.category as keyof typeof t.errorLogs.categories] || errorLog.category}
                    </span>
                    {errorLog.step && (
                      <span className="ml-1 text-xs text-gray-500">({errorLog.step})</span>
                    )}
                  </td>
                  <td className="px-3 py-4 text-sm text-gray-900 max-w-md truncate">
                    {errorLog.message}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                    {errorLog.user_email || '-'}
                  </td>
                  <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                    <button
                      onClick={() => setSelectedError(errorLog)}
                      className="text-indigo-600 hover:text-indigo-900"
                    >
                      {t.errorLogs.details}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Load more */}
          {data?.lastKey && (
            <div className="bg-gray-50 px-4 py-3 border-t border-gray-200 sm:px-6">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="w-full text-center text-sm text-indigo-600 hover:text-indigo-900 font-medium disabled:opacity-50"
              >
                {isLoadingMore ? t.errorLogs.loadingMore : t.errorLogs.loadMore}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Detail modal */}
      {selectedError && (
        <ErrorDetailModal
          error={selectedError}
          onClose={() => setSelectedError(null)}
          t={t}
        />
      )}
    </div>
  );
}
