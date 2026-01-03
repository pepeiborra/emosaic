"""
Lambda function to cancel a running Batch job.
"""
import json
import os
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
jobs_table = dynamodb.Table(os.environ['JOBS_TABLE'])
mosaics_table = dynamodb.Table(os.environ.get('MOSAICS_TABLE', ''))
batch_client = boto3.client('batch')
cors_origin = os.environ['CORS_ORIGIN']


def lambda_handler(event, context):
    """
    DELETE /jobs/{jobId}/cancel

    Cancels a running or pending Batch job.
    """
    try:
        # Get job ID from path parameters
        job_id = event['pathParameters']['jobId']

        # Get job from DynamoDB
        response = jobs_table.get_item(Key={'id': job_id})

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
                    'message': f'Job {job_id} not found'
                })
            }

        job = response['Item']
        batch_job_id = job.get('batch_job_id')

        if not batch_job_id:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': cors_origin,
                    'Access-Control-Allow-Credentials': 'true'
                },
                'body': json.dumps({
                    'error': 'Bad request',
                    'message': 'Job has no associated Batch job ID'
                })
            }

        # Check if job is already completed
        if job['status'] in ['succeeded', 'failed', 'cancelled']:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': cors_origin,
                    'Access-Control-Allow-Credentials': 'true'
                },
                'body': json.dumps({
                    'error': 'Bad request',
                    'message': f'Job is already {job["status"]} and cannot be cancelled'
                })
            }

        # Terminate Batch job
        try:
            batch_client.terminate_job(
                jobId=batch_job_id,
                reason='Cancelled by user'
            )
            print(f"Terminated Batch job {batch_job_id}")

        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == 'ClientException':
                # Job might already be completed or not found
                print(f"Warning: Could not terminate Batch job: {str(e)}")
            else:
                raise

        # Update job status in DynamoDB
        from datetime import datetime
        now = datetime.utcnow().isoformat() + 'Z'

        jobs_table.update_item(
            Key={'id': job_id},
            UpdateExpression='SET #status = :status, #updated_at = :updated_at, #completed_at = :completed_at',
            ExpressionAttributeNames={
                '#status': 'status',
                '#updated_at': 'updated_at',
                '#completed_at': 'completed_at'
            },
            ExpressionAttributeValues={
                ':status': 'cancelled',
                ':updated_at': now,
                ':completed_at': now
            }
        )

        # Update mosaic status if mosaic_id exists
        mosaic_id = job.get('mosaic_id')
        if mosaic_id and mosaics_table:
            mosaics_table.update_item(
                Key={'id': mosaic_id},
                UpdateExpression='SET #status = :status, #updated_at = :updated_at',
                ExpressionAttributeNames={
                    '#status': 'status',
                    '#updated_at': 'updated_at'
                },
                ExpressionAttributeValues={
                    ':status': 'cancelled',
                    ':updated_at': now
                }
            )

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps({
                'message': 'Job cancelled successfully',
                'job_id': job_id,
                'batch_job_id': batch_job_id
            })
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
                'message': 'Missing required parameter: jobId'
            })
        }
    except Exception as e:
        print(f"Error cancelling job: {str(e)}")
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
