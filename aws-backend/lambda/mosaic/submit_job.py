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
mosaics_table = dynamodb.Table(os.environ.get('MOSAICS_TABLE', ''))
jobs_table = dynamodb.Table(os.environ['JOBS_TABLE'])
batch_client = boto3.client('batch')
cors_origin = os.environ['CORS_ORIGIN']

# Batch configuration
JOB_QUEUE = os.environ.get('BATCH_JOB_QUEUE', '')
JOB_DEFINITION = os.environ.get('BATCH_JOB_DEFINITION', '')
S3_BUCKET = os.environ.get('S3_BUCKET', '')


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

        mosaic_id = body['mosaic_id']
        set_main = body.get('set_main', False)
        skip_cache = bool(body.get('skip_cache', False))

        # Get mosaic details from DynamoDB
        mosaic_response = mosaics_table.get_item(Key={'id': mosaic_id})
        if 'Item' not in mosaic_response:
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

        mosaic = mosaic_response['Item']

        # Generate job ID and timestamp
        job_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + 'Z'

        # Extract parameters from request or use mosaic defaults
        params = body.get('parameters', {})
        tile_size = str(params.get('tile_size', mosaic.get('tile_size', 32)))
        mode = str(params.get('mode', mosaic.get('mode', 16)))
        tint_opacity = str(params.get('tint_opacity', float(mosaic.get('tint_opacity', 0.5))))
        no_repeat = str(params.get('no_repeat', mosaic.get('no_repeat', False))).lower()
        crop = str(params.get('crop', mosaic.get('crop', False))).lower()
        randomize = str(params.get('randomize', mosaic.get('randomize', 0)))
        downsample = str(params.get('downsample', mosaic.get('downsample', 1)))

        # Build S3 paths
        source_image_key = mosaic.get('source_image_path', '').replace(f's3://{S3_BUCKET}/', '')
        output_prefix = f'mosaics/{mosaic_id}'
        tiles_prefix = mosaic.get('tiles_dir', 'tiles/').replace(f's3://{S3_BUCKET}/', '')

        # Get excluded folders (stored as a list in DynamoDB)
        excluded_folders = mosaic.get('excluded_folders', [])
        excluded_folders_str = ','.join(excluded_folders) if excluded_folders else ''

        if not source_image_key:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': cors_origin,
                    'Access-Control-Allow-Credentials': 'true'
                },
                'body': json.dumps({
                    'error': 'Bad request',
                    'message': 'Mosaic must have source_image_path set'
                })
            }

        # Submit job to AWS Batch
        batch_response = batch_client.submit_job(
            jobName=f'{mosaic_id}_{job_id}',
            jobQueue=JOB_QUEUE,
            jobDefinition=JOB_DEFINITION,
            containerOverrides={
                'environment': [
                    {'name': 'JOB_ID', 'value': job_id},
                    {'name': 'MOSAIC_ID', 'value': mosaic_id},
                    {'name': 'S3_BUCKET', 'value': S3_BUCKET},
                    {'name': 'SOURCE_IMAGE_KEY', 'value': source_image_key},
                    {'name': 'OUTPUT_KEY', 'value': f'{output_prefix}/mosaic.png'},
                    {'name': 'TILES_PREFIX', 'value': tiles_prefix},
                    {'name': 'TILE_SIZE', 'value': tile_size},
                    {'name': 'MODE', 'value': mode},
                    {'name': 'TINT_OPACITY', 'value': tint_opacity},
                    {'name': 'NO_REPEAT', 'value': no_repeat},
                    {'name': 'CROP', 'value': crop},
                    {'name': 'RANDOMIZE', 'value': randomize},
                    {'name': 'DOWNSAMPLE', 'value': downsample},
                    {'name': 'EXCLUDED_FOLDERS', 'value': excluded_folders_str},
                    {'name': 'SKIP_CACHE', 'value': 'true' if skip_cache else 'false'}
                ]
            }
        )

        batch_job_id = batch_response['jobId']

        # Build job item for DynamoDB
        job = {
            'id': job_id,
            'mosaic_id': mosaic_id,
            'status': 'submitted',
            'started_at': now,
            'updated_at': now,
            'batch_job_id': batch_job_id,
            'set_main': set_main,
            'parameters': {
                'tile_size': int(tile_size),
                'mode': int(mode),
                'tint_opacity': Decimal(tint_opacity),
                'no_repeat': no_repeat == 'true',
                'crop': crop == 'true',
                'randomize': int(randomize),
                'downsample': int(downsample)
            }
        }

        # Set TTL for 30 days from now
        job['ttl'] = int(datetime.utcnow().timestamp()) + (30 * 24 * 60 * 60)

        # Store job in DynamoDB
        jobs_table.put_item(Item=job)

        # Update mosaic status to 'processing'
        mosaics_table.update_item(
            Key={'id': mosaic_id},
            UpdateExpression='SET #status = :status, #updated_at = :updated_at, #output_path = :output_path',
            ExpressionAttributeNames={
                '#status': 'status',
                '#updated_at': 'updated_at',
                '#output_path': 'output_path'
            },
            ExpressionAttributeValues={
                ':status': 'processing',
                ':updated_at': now,
                ':output_path': f's3://{S3_BUCKET}/{output_prefix}/'
            }
        )

        print(f"Submitted Batch job {batch_job_id} for mosaic {mosaic_id}")

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
