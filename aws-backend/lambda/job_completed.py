"""
Lambda function triggered by EventBridge when AWS Batch jobs complete.
Updates job and mosaic status in DynamoDB.
"""
import json
import os
from datetime import datetime
from decimal import Decimal
import boto3

dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')
jobs_table = dynamodb.Table(os.environ['JOBS_TABLE'])
mosaics_table = dynamodb.Table(os.environ['MOSAICS_TABLE'])
s3_bucket = os.environ.get('S3_BUCKET', '')


def fetch_stats_from_s3(mosaic_id):
    """
    Fetch the stats.json file from S3 for a completed mosaic.
    Returns the stats dict or None if not found.
    """
    if not s3_bucket:
        print("S3_BUCKET not configured, skipping stats fetch")
        return None

    stats_key = f'mosaics/{mosaic_id}/mosaic.stats.json'
    try:
        response = s3_client.get_object(Bucket=s3_bucket, Key=stats_key)
        stats_json = response['Body'].read().decode('utf-8')
        stats = json.loads(stats_json)
        print(f"Successfully fetched stats for mosaic {mosaic_id}")
        return stats
    except s3_client.exceptions.NoSuchKey:
        print(f"Stats file not found: s3://{s3_bucket}/{stats_key}")
        return None
    except Exception as e:
        print(f"Error fetching stats from S3: {str(e)}")
        return None


def fetch_error_from_s3(mosaic_id):
    """
    Fetch the error.json file from S3 for a failed mosaic job.
    Returns a dict with error_code and error_message, or None if not found.
    """
    if not s3_bucket:
        print("S3_BUCKET not configured, skipping error fetch")
        return None

    error_key = f'mosaics/{mosaic_id}/error.json'
    try:
        response = s3_client.get_object(Bucket=s3_bucket, Key=error_key)
        error_json = response['Body'].read().decode('utf-8')
        error_data = json.loads(error_json)
        print(f"Successfully fetched error info for mosaic {mosaic_id}: {error_data.get('error_code', 'UNKNOWN')}")
        return error_data
    except s3_client.exceptions.NoSuchKey:
        print(f"Error file not found: s3://{s3_bucket}/{error_key}")
        return None
    except Exception as e:
        print(f"Error fetching error info from S3: {str(e)}")
        return None


def convert_to_decimal(obj):
    """
    Convert floats to Decimal for DynamoDB storage.
    """
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: convert_to_decimal(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_decimal(item) for item in obj]
    elif isinstance(obj, tuple):
        return tuple(convert_to_decimal(item) for item in obj)
    return obj


def lambda_handler(event, context):
    """
    Triggered by EventBridge when Batch job state changes.

    Event structure:
    {
        "detail": {
            "jobId": "batch-job-id",
            "jobName": "our-job-id",
            "status": "SUCCEEDED" | "FAILED",
            "statusReason": "...",
            "container": {
                "exitCode": 0,
                "logStreamName": "..."
            }
        }
    }
    """
    try:
        detail = event['detail']
        batch_job_id = detail['jobId']
        status = detail['status']
        job_name = detail.get('jobName', '')

        # Extract our job ID from the job name (we'll set this when submitting)
        # Format: {mosaic_id}_{job_id}
        parts = job_name.split('_', 1)
        if len(parts) != 2:
            print(f"Warning: Job name '{job_name}' doesn't match expected format")
            mosaic_id = None
            job_id = job_name
        else:
            mosaic_id, job_id = parts

        print(f"Processing job completion: {job_id}")
        print(f"Status: {status}")
        print(f"Mosaic ID: {mosaic_id}")
        print(f"Batch Job ID: {batch_job_id}")

        # Get current job record
        job_response = jobs_table.get_item(Key={'id': job_id})
        if 'Item' not in job_response:
            print(f"Warning: Job {job_id} not found in DynamoDB")
            return {
                'statusCode': 404,
                'body': json.dumps({'error': 'Job not found'})
            }

        job = job_response['Item']
        now = datetime.utcnow().isoformat() + 'Z'

        # Update job status
        update_expr = 'SET #status = :status, #updated_at = :updated_at, #completed_at = :completed_at'
        expr_attr_names = {
            '#status': 'status',
            '#updated_at': 'updated_at',
            '#completed_at': 'completed_at'
        }
        expr_attr_values = {
            ':status': status.lower(),
            ':updated_at': now,
            ':completed_at': now
        }

        # Add error information if failed
        if status == 'FAILED':
            status_reason = detail.get('statusReason', 'Unknown error')
            exit_code = detail.get('container', {}).get('exitCode', -1)

            # Try to fetch structured error from S3 if mosaic_id is available
            error_code = None
            error_message = status_reason

            if mosaic_id:
                error_data = fetch_error_from_s3(mosaic_id)
                if error_data:
                    error_code = error_data.get('error_code')
                    error_message = error_data.get('error_message', status_reason)

            update_expr += ', #error_message = :error_message, #exit_code = :exit_code'
            expr_attr_names['#error_message'] = 'error_message'
            expr_attr_names['#exit_code'] = 'exit_code'
            expr_attr_values[':error_message'] = error_message
            expr_attr_values[':exit_code'] = exit_code

            if error_code:
                update_expr += ', #error_code = :error_code'
                expr_attr_names['#error_code'] = 'error_code'
                expr_attr_values[':error_code'] = error_code

        # Add log stream if available
        log_stream = detail.get('container', {}).get('logStreamName')
        if log_stream:
            update_expr += ', #log_stream = :log_stream'
            expr_attr_names['#log_stream'] = 'log_stream'
            expr_attr_values[':log_stream'] = log_stream

        jobs_table.update_item(
            Key={'id': job_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_attr_names,
            ExpressionAttributeValues=expr_attr_values
        )

        print(f"Updated job {job_id} to status: {status}")

        # Update mosaic status if mosaic_id is available
        if mosaic_id:
            mosaic_status = 'completed' if status == 'SUCCEEDED' else 'failed'

            mosaic_update_expr = 'SET #status = :status, #updated_at = :updated_at'
            mosaic_expr_attr_names = {
                '#status': 'status',
                '#updated_at': 'updated_at'
            }
            mosaic_expr_attr_values = {
                ':status': mosaic_status,
                ':updated_at': now
            }

            # If succeeded, set the s3_path for the generated mosaic
            if status == 'SUCCEEDED':
                # The output path follows the pattern: mosaics/{mosaic_id}/mosaic.png
                s3_path = f'mosaics/{mosaic_id}/mosaic.png'
                stats_image_path = f'mosaics/{mosaic_id}/mosaic.stats.png'

                mosaic_update_expr += ', #s3_path = :s3_path, #stats_image_path = :stats_image_path'
                mosaic_expr_attr_names['#s3_path'] = 's3_path'
                mosaic_expr_attr_names['#stats_image_path'] = 'stats_image_path'
                mosaic_expr_attr_values[':s3_path'] = s3_path
                mosaic_expr_attr_values[':stats_image_path'] = stats_image_path

                # Fetch and store stats from S3
                stats = fetch_stats_from_s3(mosaic_id)
                if stats:
                    # Convert floats to Decimal for DynamoDB
                    stats_decimal = convert_to_decimal(stats)
                    mosaic_update_expr += ', #stats = :stats'
                    mosaic_expr_attr_names['#stats'] = 'stats'
                    mosaic_expr_attr_values[':stats'] = stats_decimal
                    print(f"Added stats to mosaic update: {stats.get('total_tiles', 0)} tiles, {stats.get('unique_tiles', 0)} unique")

            # If failed, add error message and code
            if status == 'FAILED':
                # Get structured error info if available (already fetched above)
                error_data = fetch_error_from_s3(mosaic_id) if mosaic_id else None

                mosaic_error_message = error_message if 'error_message' in locals() else detail.get('statusReason', 'Job failed')
                mosaic_update_expr += ', #error_message = :error_message'
                mosaic_expr_attr_names['#error_message'] = 'error_message'
                mosaic_expr_attr_values[':error_message'] = mosaic_error_message

                if error_data and error_data.get('error_code'):
                    mosaic_update_expr += ', #error_code = :error_code'
                    mosaic_expr_attr_names['#error_code'] = 'error_code'
                    mosaic_expr_attr_values[':error_code'] = error_data['error_code']

            mosaics_table.update_item(
                Key={'id': mosaic_id},
                UpdateExpression=mosaic_update_expr,
                ExpressionAttributeNames=mosaic_expr_attr_names,
                ExpressionAttributeValues=mosaic_expr_attr_values
            )

            print(f"Updated mosaic {mosaic_id} to status: {mosaic_status}")

        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Job status updated',
                'job_id': job_id,
                'status': status
            })
        }

    except Exception as e:
        print(f"Error processing job completion: {str(e)}")
        import traceback
        traceback.print_exc()

        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Internal error',
                'message': str(e)
            })
        }
