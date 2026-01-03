"""
Lambda function to get the count of tiles available in S3.
Uses caching to avoid slow S3 listing on every request.

Caching strategy:
- Cache total count for the tiles prefix
- Cache per-folder counts for subtraction when exclusions are specified
- This allows fast computation of excluded counts without re-listing S3
"""
import json
import os
import time
import boto3

s3_client = boto3.client('s3')
cors_origin = os.environ['CORS_ORIGIN']
S3_BUCKET = os.environ.get('S3_BUCKET', '')

# Cache duration in seconds (5 minutes)
CACHE_TTL = 300


def get_cached_data(cache_key: str) -> tuple[dict | None, float]:
    """Get cached data from S3. Returns (data, timestamp) or (None, 0)."""
    try:
        response = s3_client.get_object(Bucket=S3_BUCKET, Key=cache_key)
        data = json.loads(response['Body'].read().decode('utf-8'))
        return data, data.get('timestamp', 0)
    except s3_client.exceptions.NoSuchKey:
        return None, 0
    except Exception:
        return None, 0


def save_cached_data(cache_key: str, data: dict) -> None:
    """Save data to S3 cache file."""
    data['timestamp'] = time.time()
    try:
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=cache_key,
            Body=json.dumps(data),
            ContentType='application/json'
        )
    except Exception as e:
        print(f"Failed to save cache: {e}")


def count_tiles_by_folder(tiles_prefix: str) -> dict[str, int]:
    """
    Count tiles grouped by top-level folder.
    Returns a dict mapping folder names to their tile counts,
    plus a '_total' key for the overall count.
    """
    folder_counts: dict[str, int] = {}
    total_count = 0
    continuation_token = None

    while True:
        list_params = {
            'Bucket': S3_BUCKET,
            'Prefix': tiles_prefix,
            'MaxKeys': 1000,
        }
        if continuation_token:
            list_params['ContinuationToken'] = continuation_token

        response = s3_client.list_objects_v2(**list_params)

        for obj in response.get('Contents', []):
            key = obj['Key']
            # Get the relative path from the tiles prefix
            relative_path = key[len(tiles_prefix):]
            if not relative_path:
                continue

            # Extract the top-level folder (or use '_root' for files directly in prefix)
            parts = relative_path.split('/')
            if len(parts) > 1:
                # Build the full folder path for nested folders
                # e.g., "2023/photos/image.jpg" -> count under "2023" and "2023/photos"
                folder_path = ''
                for i, part in enumerate(parts[:-1]):  # Exclude the filename
                    if folder_path:
                        folder_path += '/'
                    folder_path += part
                    folder_counts[folder_path] = folder_counts.get(folder_path, 0) + 1

            total_count += 1

        if response.get('IsTruncated'):
            continuation_token = response.get('NextContinuationToken')
        else:
            break

    folder_counts['_total'] = total_count
    return folder_counts


def get_folder_counts(tiles_prefix: str, force_refresh: bool = False) -> dict[str, int]:
    """Get folder counts, using cache if available and fresh."""
    cache_key = f"{tiles_prefix.rstrip('/')}.folder_counts.json"

    if not force_refresh:
        cached_data, cached_time = get_cached_data(cache_key)
        cache_age = time.time() - cached_time

        if cached_data is not None and cache_age < CACHE_TTL:
            return cached_data.get('counts', {})

    # Recount and cache
    counts = count_tiles_by_folder(tiles_prefix)
    save_cached_data(cache_key, {'counts': counts})
    return counts


def lambda_handler(event, context):
    """
    GET /tiles/count

    Returns the count of available tiles in the S3 bucket.
    Uses caching to provide fast responses (cache refreshes every 5 minutes).
    Optionally excludes specified folders from the count.
    """
    try:
        query_params = event.get('queryStringParameters') or {}
        tiles_prefix = query_params.get('prefix', 'tiles/')
        force_refresh = query_params.get('refresh', 'false').lower() == 'true'
        excluded_param = query_params.get('excluded', '')

        # Parse excluded folders (comma-separated)
        excluded_folders = [f.strip() for f in excluded_param.split(',') if f.strip()] if excluded_param else []

        if not tiles_prefix.endswith('/'):
            tiles_prefix += '/'

        # Get folder counts (from cache or fresh)
        folder_counts = get_folder_counts(tiles_prefix, force_refresh)
        total_count = folder_counts.get('_total', 0)

        if excluded_folders:
            # Subtract excluded folder counts from total
            # Use a set to track which folders we've already subtracted
            # (to avoid double-counting nested folders)
            excluded_count = 0
            excluded_set = set(excluded_folders)

            for folder in excluded_folders:
                # Only count this folder if no parent folder is also excluded
                # (parent exclusion already covers the children)
                parent_excluded = False
                parts = folder.split('/')
                for i in range(len(parts) - 1):
                    parent = '/'.join(parts[:i + 1])
                    if parent in excluded_set:
                        parent_excluded = True
                        break

                if not parent_excluded:
                    excluded_count += folder_counts.get(folder, 0)

            tile_count = total_count - excluded_count

            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': cors_origin,
                    'Access-Control-Allow-Credentials': 'true'
                },
                'body': json.dumps({
                    'count': tile_count,
                    'prefix': tiles_prefix,
                    'excluded_folders': excluded_folders,
                    'cached': True  # Always uses cached folder counts
                })
            }

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps({
                'count': total_count,
                'prefix': tiles_prefix,
                'cached': True
            })
        }

    except Exception as e:
        print(f"Error counting tiles: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }
