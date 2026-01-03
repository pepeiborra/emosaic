import { useState, useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { uploadImages, type ImageUploadResult } from '../services/api';

interface FileWithPreview {
  file: File;
  preview: string;
  status: 'pending' | 'uploading' | 'success' | 'error' | 'duplicate' | 'invalid';
  errorMessage?: string;
  s3Key?: string;
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function PhotoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ExclamationCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

export function UploadImages() {
  const { user } = useAuth();
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [year, setYear] = useState<string>(new Date().getFullYear().toString());
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: async ({ files, year, email }: { files: File[]; year: string; email: string }) => {
      return uploadImages(files, year, email);
    },
    onSuccess: (results) => {
      setFiles((prevFiles) =>
        prevFiles.map((f) => {
          const result = results.find((r) => r.filename === f.file.name);
          if (result) {
            if (result.status === 'success') {
              return { ...f, status: 'success' as const, s3Key: result.s3_key };
            } else if (result.status === 'duplicate') {
              return { ...f, status: 'duplicate' as const, errorMessage: 'Duplicate image' };
            } else if (result.status === 'invalid') {
              return { ...f, status: 'invalid' as const, errorMessage: result.error || 'Invalid image' };
            } else {
              return { ...f, status: 'error' as const, errorMessage: result.error || 'Upload failed' };
            }
          }
          return f;
        })
      );
      setUploadComplete(true);
    },
    onError: (error: Error) => {
      setFiles((prevFiles) =>
        prevFiles.map((f) => ({
          ...f,
          status: 'error' as const,
          errorMessage: error.message,
        }))
      );
    },
  });

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter((file) =>
      file.type.startsWith('image/')
    );
    addFiles(droppedFiles);
  }, []);

  const addFiles = (newFiles: File[]) => {
    const filesWithPreview: FileWithPreview[] = newFiles.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      status: 'pending' as const,
    }));
    setFiles((prev) => [...prev, ...filesWithPreview]);
    setUploadComplete(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files).filter((file) =>
        file.type.startsWith('image/')
      );
      addFiles(selectedFiles);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => {
      const file = prev[index];
      URL.revokeObjectURL(file.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const clearAll = () => {
    files.forEach((f) => URL.revokeObjectURL(f.preview));
    setFiles([]);
    setUploadComplete(false);
  };

  const handleUpload = () => {
    if (!user?.email || files.length === 0) return;

    const pendingFiles = files.filter((f) => f.status === 'pending');
    if (pendingFiles.length === 0) return;

    setFiles((prev) =>
      prev.map((f) => (f.status === 'pending' ? { ...f, status: 'uploading' as const } : f))
    );

    uploadMutation.mutate({
      files: pendingFiles.map((f) => f.file),
      year,
      email: user.email,
    });
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const successCount = files.filter((f) => f.status === 'success').length;
  const duplicateCount = files.filter((f) => f.status === 'duplicate').length;
  const errorCount = files.filter((f) => f.status === 'error' || f.status === 'invalid').length;

  const getStatusBadge = (file: FileWithPreview) => {
    switch (file.status) {
      case 'uploading':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-800 mr-1" />
            Uploading
          </span>
        );
      case 'success':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircleIcon className="h-3 w-3 mr-1" />
            Uploaded
          </span>
        );
      case 'duplicate':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <ExclamationCircleIcon className="h-3 w-3 mr-1" />
            Duplicate
          </span>
        );
      case 'invalid':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
            <XCircleIcon className="h-3 w-3 mr-1" />
            Invalid
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <XCircleIcon className="h-3 w-3 mr-1" />
            Error
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            Pending
          </span>
        );
    }
  };

  // Generate year options from 2000 to current year
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: currentYear - 1999 }, (_, i) => currentYear - i);

  return (
    <div>
      {/* Header */}
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Upload Images</h1>
          <p className="mt-1 text-sm text-gray-500">
            Upload images to be stored in S3 organized by year and user
          </p>
        </div>
      </div>

      {/* Year Selection */}
      <div className="mb-6">
        <label htmlFor="year" className="block text-sm font-medium text-gray-700 mb-2">
          Image Year
        </label>
        <p className="text-sm text-gray-500 mb-2">
          Select the year these images belong to. If images have EXIF data, the year will be extracted automatically.
        </p>
        <select
          id="year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="block w-48 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {/* Drop Zone */}
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
          isDragActive
            ? 'border-indigo-500 bg-indigo-50'
            : 'border-gray-300 hover:border-gray-400 bg-white'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <PhotoIcon className="mx-auto h-12 w-12 text-gray-400" />
        <div className="mt-4">
          <span className="text-indigo-600 font-medium">Click to upload</span>
          <span className="text-gray-500"> or drag and drop</span>
        </div>
        <p className="text-sm text-gray-500 mt-2">PNG, JPG, GIF, WebP up to 10MB each</p>
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-medium text-gray-900">
                Selected Files ({files.length})
              </h2>
              {uploadComplete && (
                <div className="flex gap-2 text-sm">
                  {successCount > 0 && (
                    <span className="text-green-600">{successCount} uploaded</span>
                  )}
                  {duplicateCount > 0 && (
                    <span className="text-yellow-600">{duplicateCount} duplicates</span>
                  )}
                  {errorCount > 0 && (
                    <span className="text-red-600">{errorCount} failed</span>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={clearAll}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Clear All
              </button>
              <button
                onClick={handleUpload}
                disabled={pendingCount === 0 || uploadMutation.isPending || !user?.email}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <UploadIcon className="h-4 w-4 mr-2" />
                {uploadMutation.isPending
                  ? 'Uploading...'
                  : `Upload ${pendingCount} Image${pendingCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>

          {/* Upload destination info */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">
              Images will be uploaded to: <code className="bg-gray-200 px-1 rounded">{year}/{user?.email}/</code>
            </p>
          </div>

          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <ul className="divide-y divide-gray-200">
              {files.map((file, index) => (
                <li key={`${file.file.name}-${index}`} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center min-w-0 flex-1">
                      <img
                        src={file.preview}
                        alt={file.file.name}
                        className="h-16 w-16 object-cover rounded-lg flex-shrink-0"
                      />
                      <div className="ml-4 min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {file.file.name}
                        </p>
                        <p className="text-sm text-gray-500">
                          {(file.file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                        {file.errorMessage && (
                          <p className="text-sm text-red-600 mt-1">{file.errorMessage}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 ml-4">
                      {getStatusBadge(file)}
                      {file.status === 'pending' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(index);
                          }}
                          className="p-1 text-gray-400 hover:text-red-600"
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
