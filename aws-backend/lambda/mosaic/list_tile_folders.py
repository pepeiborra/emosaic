"""
Lambda function to list tile folders available in S3.
Returns a recursive tree structure of folders under the tiles prefix.

Optimized with:
- S3-based caching for fast responses (5 minute TTL)
- In-memory cache for warm Lambda instances
- Breadth-first S3 listing to minimize API calls
"""
import json
import os
import time
import boto3
from botocore.exceptions import ClientError

s3_client = boto3.client('s3')
cors_origin = os.environ['CORS_ORIGIN']
S3_BUCKET = os.environ.get('S3_BUCKET', '')

# Cache settings
CACHE_TTL_SECONDS = 300  # 5 minutes
CACHE_PREFIX = '.cache/'

# In-memory cache for warm Lambda instances
_memory_cache: dict = {}
_memory_cache_time: float = 0


def list_folders_recursive(tiles_prefix: str, max_depth: int = 10) -> list[dict]:
    """
    List all folders under the prefix as a tree structure.

    Uses S3's Delimiter feature to efficiently get folder prefixes without
    enumerating individual objects. Collects prefixes level by level to
    minimize API calls while respecting max_depth.
    """
    # Collect all prefixes level by level
    all_prefixes = set()
    prefixes_to_explore = [tiles_prefix]
    current_depth = 0

    while prefixes_to_explore and current_depth <= max_depth:
        next_level_prefixes = []

        for prefix in prefixes_to_explore:
            continuation_token = None

            while True:
                list_params = {
                    'Bucket': S3_BUCKET,
                    'Prefix': prefix,
                    'Delimiter': '/',
                }
                if continuation_token:
                    list_params['ContinuationToken'] = continuation_token

                response = s3_client.list_objects_v2(**list_params)

                for prefix_obj in response.get('CommonPrefixes', []):
                    full_prefix = prefix_obj['Prefix']
                    if full_prefix not in all_prefixes:
                        all_prefixes.add(full_prefix)
                        next_level_prefixes.append(full_prefix)

                if response.get('IsTruncated'):
                    continuation_token = response.get('NextContinuationToken')
                else:
                    break

        prefixes_to_explore = next_level_prefixes
        current_depth += 1

    # Build tree structure from flat list of prefixes
    def build_tree_from_prefixes(parent_prefix: str, depth: int) -> list[dict]:
        if depth > max_depth:
            return []

        # Find immediate children of this prefix
        children = []
        parent_len = len(parent_prefix)

        for prefix in all_prefixes:
            if prefix.startswith(parent_prefix) and prefix != parent_prefix:
                # Check if this is an immediate child (no intermediate folders)
                relative = prefix[parent_len:]
                # Immediate child has exactly one folder level
                if relative.count('/') == 1:
                    folder_name = relative.rstrip('/')
                    children.append({
                        'name': folder_name,
                        'prefix': prefix,
                    })

        # Sort alphabetically
        children.sort(key=lambda x: x['name'].lower())

        # Recursively add children
        for child in children:
            grandchildren = build_tree_from_prefixes(child['prefix'], depth + 1)
            if grandchildren:
                child['children'] = grandchildren

        return children

    return build_tree_from_prefixes(tiles_prefix, 0)


def count_tree_folders(folders: list[dict]) -> int:
    """Count total number of folders in tree (including nested)."""
    count = len(folders)
    for folder in folders:
        if 'children' in folder:
            count += count_tree_folders(folder['children'])
    return count


def get_cache_key(tiles_prefix: str, max_depth: int) -> str:
    """Generate a cache key for the given parameters."""
    return f"{CACHE_PREFIX}tile_folders_{tiles_prefix.replace('/', '_')}_{max_depth}.json"


def get_from_s3_cache(cache_key: str) -> dict | None:
    """Try to get cached data from S3."""
    try:
        response = s3_client.get_object(Bucket=S3_BUCKET, Key=cache_key)
        # Check if cache is still valid
        last_modified = response['LastModified'].timestamp()
        if time.time() - last_modified < CACHE_TTL_SECONDS:
            return json.loads(response['Body'].read().decode('utf-8'))
    except ClientError as e:
        if e.response['Error']['Code'] != 'NoSuchKey':
            print(f"Cache read error: {e}")
    except Exception as e:
        print(f"Cache read error: {e}")
    return None


def save_to_s3_cache(cache_key: str, data: dict) -> None:
    """Save data to S3 cache."""
    try:
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=cache_key,
            Body=json.dumps(data),
            ContentType='application/json'
        )
    except Exception as e:
        print(f"Cache write error: {e}")


def get_cached_folders(tiles_prefix: str, max_depth: int) -> dict | None:
    """Get folders from cache (memory first, then S3)."""
    global _memory_cache, _memory_cache_time

    cache_key = get_cache_key(tiles_prefix, max_depth)

    # Check in-memory cache first (fastest)
    if cache_key in _memory_cache:
        if time.time() - _memory_cache_time < CACHE_TTL_SECONDS:
            return _memory_cache[cache_key]

    # Check S3 cache
    cached = get_from_s3_cache(cache_key)
    if cached:
        # Populate memory cache
        _memory_cache[cache_key] = cached
        _memory_cache_time = time.time()
        return cached

    return None


def cache_folders(tiles_prefix: str, max_depth: int, data: dict) -> None:
    """Cache folders to both memory and S3."""
    global _memory_cache, _memory_cache_time

    cache_key = get_cache_key(tiles_prefix, max_depth)

    # Update memory cache
    _memory_cache[cache_key] = data
    _memory_cache_time = time.time()

    # Update S3 cache (async would be better but keeping it simple)
    save_to_s3_cache(cache_key, data)


def lambda_handler(event, context):
    """
    GET /tiles/folders

    Returns the list of tile folders available in the S3 bucket as a tree structure.
    Each folder can have a 'children' array containing subfolders.

    Query parameters:
    - prefix: S3 prefix to list folders from (default: 'tiles/')
    - max_depth: Maximum depth of folder tree (default: 2)
    - refresh: Set to 'true' to bypass cache and refresh data
    """
    try:
        query_params = event.get('queryStringParameters') or {}
        tiles_prefix = query_params.get('prefix', 'tiles/')
        max_depth = int(query_params.get('max_depth', '2'))
        refresh = query_params.get('refresh', '').lower() == 'true'

        if not tiles_prefix.endswith('/'):
            tiles_prefix += '/'

        # Try to get from cache first (unless refresh requested)
        cached_data = None if refresh else get_cached_folders(tiles_prefix, max_depth)

        if cached_data:
            # Return cached data with cache indicator
            response_data = cached_data.copy()
            response_data['cached'] = True
        else:
            # Fetch fresh data
            folders = list_folders_recursive(tiles_prefix, max_depth)
            total_count = count_tree_folders(folders)

            response_data = {
                'folders': folders,
                'prefix': tiles_prefix,
                'count': total_count,
                'cached': False
            }

            # Cache the result
            cache_folders(tiles_prefix, max_depth, {
                'folders': folders,
                'prefix': tiles_prefix,
                'count': total_count
            })

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps(response_data)
        }

    except Exception as e:
        print(f"Error listing tile folders: {str(e)}")
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
