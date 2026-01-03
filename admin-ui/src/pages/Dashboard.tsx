import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listMosaics } from '../services/api';
import type { Mosaic } from '../types/api';

function StatusBadge({ status }: { status: Mosaic['status'] }) {
  const styles = {
    pending: 'bg-yellow-100 text-yellow-800',
    processing: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function MosaicCard({ mosaic }: { mosaic: Mosaic }) {
  // Priority: thumbnail > full mosaic > source image
  const previewUrl = mosaic.thumbnail_path
    ? `/${mosaic.thumbnail_path}`
    : mosaic.s3_path
    ? `/${mosaic.s3_path}`
    : mosaic.source_image_path
    ? `/${mosaic.source_image_path}`
    : null;

  return (
    <Link
      to={`/mosaic/${mosaic.id}`}
      className="group relative bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="aspect-square bg-gray-100">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={mosaic.title || 'Mosaic'}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-900 truncate">
            {mosaic.title || `Mosaic ${mosaic.id.slice(0, 8)}`}
          </h3>
          {mosaic.is_main && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">
              Main
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <StatusBadge status={mosaic.status} />
          <span className="text-xs text-gray-500">
            {new Date(mosaic.created_at).toLocaleDateString()}
          </span>
        </div>
      </div>
    </Link>
  );
}

function MosaicSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden animate-pulse">
      <div className="aspect-square bg-gray-200" />
      <div className="p-4">
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-1/2" />
      </div>
    </div>
  );
}

export function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['mosaics'],
    queryFn: () => listMosaics(50),
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mosaics</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your photo mosaics
          </p>
        </div>
        <Link
          to="/create"
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Create New
        </Link>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4 mb-6">
          <p className="text-sm text-red-700">
            Failed to load mosaics: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <MosaicSkeleton key={i} />
          ))}
        </div>
      ) : data?.items.length === 0 ? (
        <div className="text-center py-12">
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
          <h3 className="mt-2 text-sm font-medium text-gray-900">No mosaics</h3>
          <p className="mt-1 text-sm text-gray-500">
            Get started by creating a new mosaic.
          </p>
          <div className="mt-6">
            <Link
              to="/create"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
            >
              Create Mosaic
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {data?.items.map((mosaic) => (
            <MosaicCard key={mosaic.id} mosaic={mosaic} />
          ))}
        </div>
      )}
    </div>
  );
}
