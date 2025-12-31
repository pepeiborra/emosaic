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

        # Validate required fields
        if 'title' not in body:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': cors_origin,
                    'Access-Control-Allow-Credentials': 'true'
                },
                'body': json.dumps({
                    'error': 'Bad request',
                    'message': 'Missing required field: title'
                })
            }

        # Generate unique ID and timestamp
        mosaic_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + 'Z'

        # Build mosaic item
        item = {
            'id': mosaic_id,
            'title': body['title'],
            'description': body.get('description', ''),
            'tile_size': int(body.get('tile_size', 32)),
            'mode': int(body.get('mode', 16)),
            'tint_opacity': Decimal(str(body.get('tint_opacity', 0.5))),
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
