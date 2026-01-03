"""
Lambda function to get a single mosaic by ID with job history.
"""
import json
import os
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
mosaics_table = dynamodb.Table(os.environ['MOSAICS_TABLE'])
jobs_table = dynamodb.Table(os.environ.get('JOBS_TABLE', ''))
cors_origin = os.environ['CORS_ORIGIN']


class DecimalEncoder(json.JSONEncoder):
    """Helper to convert DynamoDB Decimal types to JSON"""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super(DecimalEncoder, self).default(obj)


def transform_mosaic(item):
    """Transform DynamoDB item to match frontend expected format."""
    result = {
        'id': item['id'],
        'title': item.get('title'),
        'status': item.get('status', 'pending'),
        'is_main': item.get('is_main', 0) == 1,  # Convert to boolean
        'created_at': item.get('created_at'),
        'updated_at': item.get('updated_at'),
        's3_path': item.get('s3_path'),
        'thumbnail_path': item.get('thumbnail_path'),
        'source_image_path': item.get('source_image_path'),
        'stats_image_path': item.get('stats_image_path'),
    }

    # Include stats if available
    if 'stats' in item:
        result['stats'] = item['stats']

    # Build config object from individual fields or nested config
    if 'config' in item:
        result['config'] = item['config']
    else:
        result['config'] = {
            'tile_size': item.get('tile_size', 32),
            'mode': item.get('mode', 16),
            'tint_opacity': float(item.get('tint_opacity', 0.5)),
            'no_repeat': item.get('no_repeat', False),
            'crop': item.get('crop', False),
            'downsample': item.get('downsample', 1),
        }

    return result


def lambda_handler(event, context):
    """
    GET /mosaics/{mosaicId}?include_jobs=true

    Returns a single mosaic by ID.
    Optional: include_jobs=true to include job history
    """
    try:
        # Get mosaic ID from path parameters
        mosaic_id = event['pathParameters']['mosaicId']

        # Get query parameters
        params = event.get('queryStringParameters') or {}
        include_jobs = params.get('include_jobs', 'false').lower() == 'true'

        # Get item from DynamoDB
        response = mosaics_table.get_item(Key={'id': mosaic_id})

        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': cors_origin,
                    'Access-Control-Allow-Credentials': 'true'
                },
                'body': json.dumps({
                    'error': 'Not found',
                    'message': f'Mosaic {mosaic_id} not found'
                })
            }

        mosaic = response['Item']

        # Transform to match frontend expected format
        transformed_mosaic = transform_mosaic(mosaic)

        # Optionally include job history
        if include_jobs and jobs_table:
            try:
                # Query jobs by mosaic_id using GSI
                jobs_response = jobs_table.query(
                    IndexName='by-mosaic-id',
                    KeyConditionExpression=Key('mosaic_id').eq(mosaic_id),
                    ScanIndexForward=False,  # Newest first
                    Limit=10  # Last 10 jobs
                )

                transformed_mosaic['jobs'] = jobs_response.get('Items', [])
            except Exception as e:
                print(f"Warning: Failed to fetch jobs: {str(e)}")
                transformed_mosaic['jobs'] = []

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps(transformed_mosaic, cls=DecimalEncoder)
        }

    except KeyError as e:
        return {
            'statusCode': 400,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps({
                'error': 'Bad request',
                'message': 'Missing required parameter: mosaicId'
            })
        }
    except Exception as e:
        print(f"Error getting mosaic: {str(e)}")
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
