"""
Lambda function to get the count of tiles available in S3.
Uses caching to avoid slow S3 listing on every request.
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


def get_cached_count(tiles_prefix: str) -> tuple[int | None, float]:
    """Get cached count from S3 metadata file. Returns (count, timestamp) or (None, 0)."""
    cache_key = f"{tiles_prefix.rstrip('/')}.count.json"
    try:
        response = s3_client.get_object(Bucket=S3_BUCKET, Key=cache_key)
        data = json.loads(response['Body'].read().decode('utf-8'))
        return data.get('count'), data.get('timestamp', 0)
    except s3_client.exceptions.NoSuchKey:
        return None, 0
    except Exception:
        return None, 0


def save_cached_count(tiles_prefix: str, count: int) -> None:
    """Save count to S3 cache file."""
    cache_key = f"{tiles_prefix.rstrip('/')}.count.json"
    data = {
        'count': count,
        'timestamp': time.time(),
        'prefix': tiles_prefix
    }
    try:
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=cache_key,
            Body=json.dumps(data),
            ContentType='application/json'
        )
    except Exception as e:
        print(f"Failed to save cache: {e}")


def count_tiles(tiles_prefix: str) -> int:
    """Count all tiles under the prefix."""
    count = 0
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
        count += response.get('KeyCount', 0)

        if response.get('IsTruncated'):
            continuation_token = response.get('NextContinuationToken')
        else:
            break

    return count


def lambda_handler(event, context):
    """
    GET /tiles/count

    Returns the count of available tiles in the S3 bucket.
    Uses caching to provide fast responses (cache refreshes every 5 minutes).
    """
    try:
        query_params = event.get('queryStringParameters') or {}
        tiles_prefix = query_params.get('prefix', 'tiles/')
        force_refresh = query_params.get('refresh', 'false').lower() == 'true'

        if not tiles_prefix.endswith('/'):
            tiles_prefix += '/'

        # Check cache first
        cached_count, cached_time = get_cached_count(tiles_prefix)
        cache_age = time.time() - cached_time

        if cached_count is not None and cache_age < CACHE_TTL and not force_refresh:
            # Return cached value
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': cors_origin,
                    'Access-Control-Allow-Credentials': 'true'
                },
                'body': json.dumps({
                    'count': cached_count,
                    'prefix': tiles_prefix,
                    'cached': True,
                    'cache_age_seconds': int(cache_age)
                })
            }

        # Count tiles and update cache
        tile_count = count_tiles(tiles_prefix)
        save_cached_count(tiles_prefix, tile_count)

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
                'cached': False
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
