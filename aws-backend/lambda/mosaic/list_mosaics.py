"""
Lambda function to list all mosaics with pagination support.
"""
import json
import os
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['MOSAICS_TABLE'])
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
    }

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
        }

    return result


def lambda_handler(event, context):
    """
    GET /mosaics?limit=20&lastKey=<id>

    Returns list of mosaics with pagination.
    """
    try:
        # Get query parameters
        params = event.get('queryStringParameters') or {}
        limit = int(params.get('limit', 20))
        last_key = params.get('lastKey')

        # Build scan parameters - we scan all mosaics and sort by created_at
        scan_params = {
            'Limit': limit
        }

        # Add pagination token if provided
        if last_key:
            scan_params['ExclusiveStartKey'] = {
                'id': last_key
            }

        # Scan the table (since we need all mosaics, not just is_main=1)
        response = table.scan(**scan_params)

        # Sort by created_at descending (newest first)
        items = response.get('Items', [])
        items.sort(key=lambda x: x.get('created_at', ''), reverse=True)

        # Transform items to match frontend expected format
        transformed_items = [transform_mosaic(item) for item in items]

        # Prepare response
        result = {
            'mosaics': transformed_items,
            'count': len(transformed_items)
        }

        # Add pagination token if there are more results
        if 'LastEvaluatedKey' in response:
            result['lastKey'] = response['LastEvaluatedKey']['id']

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps(result, cls=DecimalEncoder)
        }

    except Exception as e:
        print(f"Error listing mosaics: {str(e)}")
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
