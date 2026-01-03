"""
Lambda function to create a new mosaic.
"""
import json
import os
import uuid
from datetime import datetime
from decimal import Decimal
import boto3

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['MOSAICS_TABLE'])
s3 = boto3.client('s3')
bucket_name = os.environ['TILES_BUCKET']
cors_origin = os.environ['CORS_ORIGIN']


class DecimalEncoder(json.JSONEncoder):
    """Helper to convert DynamoDB Decimal types to JSON"""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super(DecimalEncoder, self).default(obj)


def lambda_handler(event, context):
    """
    POST /mosaics

    Creates a new mosaic entry.

    Request body:
    {
        "title": "My Mosaic",
        "description": "Optional description",
        "tile_size": 32,
        "mode": 16,
        "tint_opacity": 0.5,
        "is_main": true
    }
    """
    try:
        # Parse request body
        body = json.loads(event['body'])

        # Generate unique ID and timestamp
        mosaic_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + 'Z'

        # Extract config from body (frontend sends nested config object)
        config = body.get('config', {})

        # Build mosaic item - store config as nested object to match frontend expectations
        item = {
            'id': mosaic_id,
            'title': body.get('title', ''),
            'description': body.get('description', ''),
            # Store individual fields for backward compatibility with batch job
            'tile_size': int(config.get('tile_size', body.get('tile_size', 32))),
            'mode': int(config.get('mode', body.get('mode', 16))),
            'tint_opacity': Decimal(str(config.get('tint_opacity', body.get('tint_opacity', 0.5)))),
            'no_repeat': config.get('no_repeat', body.get('no_repeat', False)),
            'crop': config.get('crop', body.get('crop', False)),
            'downsample': int(config.get('downsample', body.get('downsample', 1))),
            'is_main': 1 if body.get('is_main', False) else 0,
            'created_at': now,
            'updated_at': now,
            'status': 'pending'
        }

        # Optional fields
        if 'source_image_path' in body:
            item['source_image_path'] = body['source_image_path']
        if 'output_path' in body:
            item['output_path'] = body['output_path']
        if 'tiles_dir' in body:
            item['tiles_dir'] = body['tiles_dir']

        # Handle excluded_folders from config
        excluded_folders = config.get('excluded_folders', [])
        if excluded_folders:
            item['excluded_folders'] = excluded_folders

        # Store in DynamoDB
        table.put_item(Item=item)

        return {
            'statusCode': 201,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps(item, cls=DecimalEncoder)
        }

    except json.JSONDecodeError:
        return {
            'statusCode': 400,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps({
                'error': 'Bad request',
                'message': 'Invalid JSON in request body'
            })
        }
    except Exception as e:
        print(f"Error creating mosaic: {str(e)}")
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
