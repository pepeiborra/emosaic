"""
Lambda function to list tile folders available in S3.
Returns a list of folder names under the tiles prefix.
"""
import json
import os
import boto3

s3_client = boto3.client('s3')
cors_origin = os.environ['CORS_ORIGIN']
S3_BUCKET = os.environ.get('S3_BUCKET', '')


def list_folders(tiles_prefix: str) -> list[dict]:
    """List all folders under the prefix with their tile counts."""
    folders = []

    # Use delimiter to get "virtual folders"
    continuation_token = None

    while True:
        list_params = {
            'Bucket': S3_BUCKET,
            'Prefix': tiles_prefix,
            'Delimiter': '/',
        }
        if continuation_token:
            list_params['ContinuationToken'] = continuation_token

        response = s3_client.list_objects_v2(**list_params)

        # Get common prefixes (folders)
        for prefix_obj in response.get('CommonPrefixes', []):
            full_prefix = prefix_obj['Prefix']
            # Extract folder name (remove base prefix and trailing slash)
            folder_name = full_prefix[len(tiles_prefix):].rstrip('/')
            if folder_name:  # Skip empty names
                folders.append({
                    'name': folder_name,
                    'prefix': full_prefix,
                })

        if response.get('IsTruncated'):
            continuation_token = response.get('NextContinuationToken')
        else:
            break

    # Sort folders alphabetically
    folders.sort(key=lambda x: x['name'].lower())

    return folders


def lambda_handler(event, context):
    """
    GET /tiles/folders

    Returns the list of tile folders available in the S3 bucket.
    """
    try:
        query_params = event.get('queryStringParameters') or {}
        tiles_prefix = query_params.get('prefix', 'tiles/')

        if not tiles_prefix.endswith('/'):
            tiles_prefix += '/'

        folders = list_folders(tiles_prefix)

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps({
                'folders': folders,
                'prefix': tiles_prefix,
                'count': len(folders)
            })
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
