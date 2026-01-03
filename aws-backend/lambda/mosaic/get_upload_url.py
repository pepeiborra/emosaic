"""
Lambda function to generate presigned URLs for uploading files to S3.
"""
import json
import os
import uuid
from datetime import datetime
import boto3
from botocore.exceptions import ClientError

s3_client = boto3.client('s3')
bucket_name = os.environ['TILES_BUCKET']
cors_origin = os.environ['CORS_ORIGIN']


def lambda_handler(event, context):
    """
    POST /upload-url

    Generates a presigned URL for uploading files to S3.

    Request body:
    {
        "filename": "image.jpg",
        "content_type": "image/jpeg",
        "upload_type": "source" | "tile"
    }

    Response:
    {
        "upload_url": "https://...",
        "s3_key": "uploads/...",
        "expires_in": 3600
    }
    """
    try:
        # Parse request body
        body = json.loads(event['body'])

        # Validate required fields
        if 'filename' not in body:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': cors_origin,
                    'Access-Control-Allow-Credentials': 'true'
                },
                'body': json.dumps({
                    'error': 'Bad request',
                    'message': 'Missing required field: filename'
                })
            }

        filename = body['filename']
        content_type = body.get('content_type', 'application/octet-stream')
        upload_type = body.get('upload_type', 'source')  # source, tile

        # Validate content type
        allowed_types = [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/gif',
            'image/webp'
        ]

        if content_type not in allowed_types:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': cors_origin,
                    'Access-Control-Allow-Credentials': 'true'
                },
                'body': json.dumps({
                    'error': 'Bad request',
                    'message': f'Invalid content type. Allowed: {", ".join(allowed_types)}'
                })
            }

        # Generate unique S3 key
        timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
        unique_id = str(uuid.uuid4())[:8]

        # Sanitize filename (keep extension)
        ext = filename.rsplit('.', 1)[-1] if '.' in filename else 'jpg'
        safe_filename = f"{timestamp}-{unique_id}.{ext}"

        # Determine S3 prefix based on upload type
        if upload_type == 'tile':
            s3_key = f'tiles/{safe_filename}'
        else:  # source
            s3_key = f'uploads/{safe_filename}'

        # Generate presigned URL for PUT operation
        expiration = 3600  # 1 hour

        try:
            upload_url = s3_client.generate_presigned_url(
                'put_object',
                Params={
                    'Bucket': bucket_name,
                    'Key': s3_key,
                    'ContentType': content_type
                },
                ExpiresIn=expiration
            )

        except ClientError as e:
            print(f"Error generating presigned URL: {str(e)}")
            return {
                'statusCode': 500,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': cors_origin,
                    'Access-Control-Allow-Credentials': 'true'
                },
                'body': json.dumps({
                    'error': 'Internal server error',
                    'message': 'Failed to generate upload URL'
                })
            }

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps({
                'upload_url': upload_url,
                's3_key': s3_key,
                's3_path': f's3://{bucket_name}/{s3_key}',
                'expires_in': expiration,
                'instructions': 'Use PUT method with Content-Type header matching the provided content_type'
            })
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
        print(f"Error generating presigned URL: {str(e)}")
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
