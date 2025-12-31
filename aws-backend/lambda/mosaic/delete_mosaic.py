"""
Lambda function to delete a mosaic and its associated resources.
"""
import json
import os
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['MOSAICS_TABLE'])
s3 = boto3.client('s3')
bucket_name = os.environ['TILES_BUCKET']
cors_origin = os.environ['CORS_ORIGIN']


def lambda_handler(event, context):
    """
    DELETE /mosaics/{mosaicId}

    Deletes a mosaic and optionally its S3 resources.
    Query parameter 'deleteFiles=true' will also delete S3 files.
    """
    try:
        # Get mosaic ID from path parameters
        mosaic_id = event['pathParameters']['mosaicId']

        # Get query parameters
        params = event.get('queryStringParameters') or {}
        delete_files = params.get('deleteFiles', 'false').lower() == 'true'

        # Get mosaic to check if it exists and get file paths
        response = table.get_item(Key={'id': mosaic_id})
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

        # Delete S3 files if requested
        if delete_files:
            files_to_delete = []

            # Collect all file paths
            if 'source_image_path' in mosaic:
                files_to_delete.append(mosaic['source_image_path'])
            if 'output_path' in mosaic:
                files_to_delete.append(mosaic['output_path'])

            # Delete files from S3
            for file_path in files_to_delete:
                try:
                    # Remove bucket name prefix if present
                    key = file_path.replace(f's3://{bucket_name}/', '')
                    s3.delete_object(Bucket=bucket_name, Key=key)
                    print(f"Deleted S3 object: {key}")
                except ClientError as e:
                    print(f"Error deleting S3 object {key}: {str(e)}")
                    # Continue with deletion even if S3 delete fails

        # Delete from DynamoDB
        table.delete_item(Key={'id': mosaic_id})

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps({
                'message': 'Mosaic deleted successfully',
                'id': mosaic_id,
                'filesDeleted': delete_files
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
                'message': 'Missing required parameter: mosaicId'
            })
        }
    except Exception as e:
        print(f"Error deleting mosaic: {str(e)}")
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
