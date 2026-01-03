import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { createMosaic, getUploadUrl, uploadFileToS3, submitJob } from '../services/api';
import type { MosaicConfig } from '../types/api';

const TILE_SIZES = [16, 32, 64];
const MODES = [
  { value: 1, label: '1 (Fastest, single color match)' },
  { value: 4, label: '4 (2x2 grid matching)' },
  { value: 9, label: '9 (3x3 grid matching)' },
  { value: 16, label: '16 (4x4 grid matching)' },
  { value: 25, label: '25 (5x5 grid matching)' },
  { value: 32, label: '32 (Best quality)' },
  { value: 0, label: 'Random (ignore source)' },
];

export function CreateMosaic() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [config, setConfig] = useState<MosaicConfig>({
    tile_size: 32,
    mode: 16,
    tint_opacity: 0.3,
    no_repeat: false,
    crop: false,
  });
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(selectedFile);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('image/')) {
      setFile(droppedFile);
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(droppedFile);
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
            disabled={!file || createMutation.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Mosaic'}
          </button>
        </div>
      </form>
    </div>
  );
}
