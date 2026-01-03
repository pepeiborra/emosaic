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
jobs_table = dynamodb.Table(os.environ['JOBS_TABLE'])
mosaics_table = dynamodb.Table(os.environ['MOSAICS_TABLE'])


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

            update_expr += ', #error_message = :error_message, #exit_code = :exit_code'
            expr_attr_names['#error_message'] = 'error_message'
            expr_attr_names['#exit_code'] = 'exit_code'
            expr_attr_values[':error_message'] = status_reason
            expr_attr_values[':exit_code'] = exit_code

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

            # If failed, add error message
            if status == 'FAILED':
                mosaic_update_expr += ', #error_message = :error_message'
                mosaic_expr_attr_names['#error_message'] = 'error_message'
                mosaic_expr_attr_values[':error_message'] = detail.get('statusReason', 'Job failed')

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
