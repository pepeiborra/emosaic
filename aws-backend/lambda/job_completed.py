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
cloudfront_client = boto3.client('cloudfront')
jobs_table = dynamodb.Table(os.environ['JOBS_TABLE'])
mosaics_table = dynamodb.Table(os.environ['MOSAICS_TABLE'])
s3_bucket = os.environ.get('S3_BUCKET', '')
admin_bucket = os.environ.get('ADMIN_BUCKET', '')
cloudfront_distribution_id = os.environ.get('CLOUDFRONT_DISTRIBUTION_ID', '')


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


def invalidate_cloudfront_cache(mosaic_id):
    """
    Invalidate CloudFront cache for a mosaic's files.
    This ensures the latest generated files are served immediately.
    """
    if not cloudfront_distribution_id:
        print("CLOUDFRONT_DISTRIBUTION_ID not configured, skipping cache invalidation")
        return False

    try:
        # Invalidate all files in the mosaic's directory
        invalidation_path = f'/mosaics/{mosaic_id}/*'

        response = cloudfront_client.create_invalidation(
            DistributionId=cloudfront_distribution_id,
            InvalidationBatch={
                'Paths': {
                    'Quantity': 1,
                    'Items': [invalidation_path]
                },
                'CallerReference': f'{mosaic_id}-{datetime.utcnow().timestamp()}'
            }
        )

        invalidation_id = response['Invalidation']['Id']
        print(f"Created CloudFront invalidation {invalidation_id} for {invalidation_path}")
        return True
    except Exception as e:
        print(f"Error creating CloudFront invalidation: {str(e)}")
        return False


def copy_files_to_admin_bucket(mosaic_id):
    """
    Copy mosaic files to admin bucket for landing page display.
    This is called when a job completes with set_main=True.
    """
    if not s3_bucket or not admin_bucket:
        print("S3_BUCKET or ADMIN_BUCKET not configured, skipping file copy")
        return False

    import time

    # Files to copy from tiles bucket to admin bucket
    files_to_copy = [
        ('mosaic.png', 'mosaic.png', 'image/png'),
        ('mosaic_widget.html', 'index.html', 'text/html; charset=utf-8'),
        ('mosaic-widget.css', 'mosaic-widget.css', 'text/css'),
        ('mosaic-widget.js', 'mosaic-widget.js', 'application/javascript'),
    ]

    copy_errors = []
    for src_file, dst_file, content_type in files_to_copy:
        try:
            source_key = f'mosaics/{mosaic_id}/{src_file}'
            s3_client.copy_object(
                Bucket=admin_bucket,
                CopySource={'Bucket': s3_bucket, 'Key': source_key},
                Key=dst_file,
                ContentType=content_type,
                MetadataDirective='REPLACE'
            )
            print(f"Copied {source_key} to {admin_bucket}/{dst_file}")
        except Exception as copy_error:
            error_msg = f"Failed to copy {src_file}: {str(copy_error)}"
            print(error_msg)
            copy_errors.append(error_msg)

    if copy_errors:
        print(f"Copy errors: {copy_errors}")
        return False

    # Invalidate CloudFront cache for root files
    if cloudfront_distribution_id:
        try:
            invalidation_response = cloudfront_client.create_invalidation(
                DistributionId=cloudfront_distribution_id,
                InvalidationBatch={
                    'Paths': {
                        'Quantity': 5,
                        'Items': [
                            '/',
                            '/index.html',
                            '/mosaic.png',
                            '/mosaic-widget.css',
                            '/mosaic-widget.js'
                        ]
                    },
                    'CallerReference': f'set-main-{mosaic_id}-{time.time()}'
                }
            )
            invalidation_id = invalidation_response['Invalidation']['Id']
            print(f"Created CloudFront invalidation for root files: {invalidation_id}")
        except Exception as cf_error:
            print(f"CloudFront invalidation failed (non-fatal): {str(cf_error)}")

    return True


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
                thumbnail_path = f'mosaics/{mosaic_id}/mosaic.thumb.png'

                mosaic_update_expr += ', #s3_path = :s3_path, #stats_image_path = :stats_image_path, #thumbnail_path = :thumbnail_path'
                mosaic_expr_attr_names['#s3_path'] = 's3_path'
                mosaic_expr_attr_names['#stats_image_path'] = 'stats_image_path'
                mosaic_expr_attr_names['#thumbnail_path'] = 'thumbnail_path'
                mosaic_expr_attr_values[':s3_path'] = s3_path
                mosaic_expr_attr_values[':stats_image_path'] = stats_image_path
                mosaic_expr_attr_values[':thumbnail_path'] = thumbnail_path

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

            # Invalidate CloudFront cache for the mosaic files on success
            if status == 'SUCCEEDED':
                invalidate_cloudfront_cache(mosaic_id)

                # If job has set_main flag, copy files to admin bucket for landing page
                if job.get('set_main'):
                    print(f"Job has set_main=True, copying files to admin bucket")
                    copy_files_to_admin_bucket(mosaic_id)

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
