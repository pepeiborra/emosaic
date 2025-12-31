"""
Lambda function to submit a new mosaic generation job.
"""
import json
import os
import uuid
from datetime import datetime
from decimal import Decimal
import boto3


class DecimalEncoder(json.JSONEncoder):
    """Helper to convert DynamoDB Decimal types to JSON"""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super(DecimalEncoder, self).default(obj)


dynamodb = boto3.resource('dynamodb')
jobs_table = dynamodb.Table(os.environ['JOBS_TABLE'])
cors_origin = os.environ['CORS_ORIGIN']


def lambda_handler(event, context):
    """
    POST /jobs

    Submits a new mosaic generation job.

    Request body:
    {
        "mosaic_id": "uuid-of-mosaic",
        "parameters": {
            "tile_size": 32,
            "mode": 16,
            "tint_opacity": 0.5
        }
    }
    """
    try:
        # Parse request body
        body = json.loads(event['body'])

        # Validate required fields
        if 'mosaic_id' not in body:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': cors_origin,
                    'Access-Control-Allow-Credentials': 'true'
                },
                'body': json.dumps({
                    'error': 'Bad request',
                    'message': 'Missing required field: mosaic_id'
                })
            }

        # Generate job ID and timestamp
        job_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + 'Z'

        # Build job item
        job = {
            'id': job_id,
            'mosaic_id': body['mosaic_id'],
            'status': 'pending',
            'started_at': now,
            'updated_at': now,
            'parameters': body.get('parameters', {})
        }

        # Set TTL for 30 days from now (optional cleanup)
        job['ttl'] = int(datetime.utcnow().timestamp()) + (30 * 24 * 60 * 60)

        # Store job in DynamoDB
        jobs_table.put_item(Item=job)

        # TODO: Submit job to AWS Batch or start Step Function
        # For now, this is just tracking the job status

        return {
            'statusCode': 201,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps(job, cls=DecimalEncoder)
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
        print(f"Error submitting job: {str(e)}")
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
