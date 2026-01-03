"""
Lambda functions for image upload management.

Endpoints:
- POST /images/upload-urls - Generate presigned URLs for bulk upload
- POST /images/check-duplicates - Check for duplicate images by hash
- POST /images/confirm - Confirm successful uploads and store metadata
"""
import json
import os
import hashlib
from datetime import datetime
from decimal import Decimal
import boto3
from botocore.exceptions import ClientError

s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
bucket_name = os.environ.get('TILES_BUCKET', '')
cors_origin = os.environ.get('CORS_ORIGIN', '*')
images_table_name = os.environ.get('IMAGES_TABLE', '')

# Helper to get DynamoDB table
def get_images_table():
    return dynamodb.Table(images_table_name)


def make_response(status_code: int, body: dict) -> dict:
    """Create a standard API Gateway response."""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': cors_origin,
            'Access-Control-Allow-Credentials': 'true'
        },
        'body': json.dumps(body, default=str)
    }


def get_upload_urls_handler(event, context):
    """
    POST /images/upload-urls

    Generate presigned URLs for bulk file upload.

    Request body:
    {
        "files": [{"filename": "img.jpg", "content_type": "image/jpeg"}, ...],
        "year": "2024",
        "email": "user@example.com"
    }

    Response:
    {
        "uploads": [
            {"filename": "img.jpg", "upload_url": "https://...", "s3_key": "2024/user@example.com/..."}
        ]
    }
    """
    try:
        body = json.loads(event['body'])

        files = body.get('files', [])
        year = body.get('year', str(datetime.utcnow().year))
        email = body.get('email', 'unknown')

        if not files:
            return make_response(400, {
                'error': 'Bad request',
                'message': 'No files provided'
            })

        # Validate content types
        allowed_types = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']

        uploads = []
        for file_info in files:
            filename = file_info.get('filename', '')
            content_type = file_info.get('content_type', 'application/octet-stream')

            if content_type not in allowed_types:
                continue  # Skip invalid file types

            # Generate unique S3 key: year/email/timestamp-uuid.ext
            timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
            import uuid
            unique_id = str(uuid.uuid4())[:8]
            ext = filename.rsplit('.', 1)[-1] if '.' in filename else 'jpg'
            safe_filename = f"{timestamp}-{unique_id}.{ext}"

            # Sanitize email for use in path
            safe_email = email.replace('@', '_at_').replace('.', '_')
            s3_key = f"tiles/{year}/{safe_email}/{safe_filename}"

            try:
                upload_url = s3_client.generate_presigned_url(
                    'put_object',
                    Params={
                        'Bucket': bucket_name,
                        'Key': s3_key,
                        'ContentType': content_type
                    },
                    ExpiresIn=3600
                )

                uploads.append({
                    'filename': filename,
                    'upload_url': upload_url,
                    's3_key': s3_key
                })
            except ClientError as e:
                print(f"Error generating presigned URL for {filename}: {e}")
                continue

        return make_response(200, {'uploads': uploads})

    except json.JSONDecodeError:
        return make_response(400, {
            'error': 'Bad request',
            'message': 'Invalid JSON in request body'
        })
    except Exception as e:
        print(f"Error in get_upload_urls_handler: {e}")
        return make_response(500, {
            'error': 'Internal server error',
            'message': str(e)
        })


def check_duplicates_handler(event, context):
    """
    POST /images/check-duplicates

    Check which image hashes already exist in the database.

    Request body:
    {
        "hashes": ["abc123...", "def456...", ...]
    }

    Response:
    {
        "duplicates": ["abc123...", ...]
    }
    """
    try:
        body = json.loads(event['body'])
        hashes = body.get('hashes', [])

        if not hashes:
            return make_response(200, {'duplicates': []})

        table = get_images_table()
        duplicates = []

        # Check each hash in DynamoDB
        # For efficiency, we batch get items
        for hash_value in hashes:
            try:
                response = table.get_item(
                    Key={'image_hash': hash_value}
                )
                if 'Item' in response:
                    duplicates.append(hash_value)
            except ClientError as e:
                print(f"Error checking hash {hash_value}: {e}")
                continue

        return make_response(200, {'duplicates': duplicates})

    except json.JSONDecodeError:
        return make_response(400, {
            'error': 'Bad request',
            'message': 'Invalid JSON in request body'
        })
    except Exception as e:
        print(f"Error in check_duplicates_handler: {e}")
        return make_response(500, {
            'error': 'Internal server error',
            'message': str(e)
        })


def confirm_uploads_handler(event, context):
    """
    POST /images/confirm

    Confirm successful uploads and store metadata in DynamoDB.

    Request body:
    {
        "uploads": [
            {"s3_key": "...", "hash": "...", "filename": "..."},
            ...
        ]
    }

    Response:
    {
        "results": [...],
        "total": 10,
        "successful": 8,
        "duplicates": 1,
        "invalid": 0,
        "errors": 1
    }
    """
    try:
        body = json.loads(event['body'])
        uploads = body.get('uploads', [])

        if not uploads:
            return make_response(200, {
                'results': [],
                'total': 0,
                'successful': 0,
                'duplicates': 0,
                'invalid': 0,
                'errors': 0
            })

        table = get_images_table()
        results = []
        successful = 0
        duplicates = 0
        errors = 0

        for upload in uploads:
            s3_key = upload.get('s3_key', '')
            hash_value = upload.get('hash', '')
            filename = upload.get('filename', '')

            if not s3_key or not hash_value:
                results.append({
                    'filename': filename,
                    'status': 'error',
                    'error': 'Missing s3_key or hash'
                })
                errors += 1
                continue

            try:
                # Verify the object exists in S3
                try:
                    s3_client.head_object(Bucket=bucket_name, Key=s3_key)
                except ClientError:
                    results.append({
                        'filename': filename,
                        'status': 'error',
                        'error': 'File not found in S3'
                    })
                    errors += 1
                    continue

                # Try to insert into DynamoDB (will fail if hash already exists)
                # Use conditional expression to prevent duplicates
                try:
                    table.put_item(
                        Item={
                            'image_hash': hash_value,
                            's3_key': s3_key,
                            'filename': filename,
                            'uploaded_at': datetime.utcnow().isoformat(),
                            'bucket': bucket_name
                        },
                        ConditionExpression='attribute_not_exists(image_hash)'
                    )
                    results.append({
                        'filename': filename,
                        'status': 'success',
                        's3_key': s3_key
                    })
                    successful += 1
                except ClientError as e:
                    if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                        results.append({
                            'filename': filename,
                            'status': 'duplicate'
                        })
                        duplicates += 1
                    else:
                        raise

            except Exception as e:
                print(f"Error confirming upload for {filename}: {e}")
                results.append({
                    'filename': filename,
                    'status': 'error',
                    'error': str(e)
                })
                errors += 1

        return make_response(200, {
            'results': results,
            'total': len(uploads),
            'successful': successful,
            'duplicates': duplicates,
            'invalid': 0,
            'errors': errors
        })

    except json.JSONDecodeError:
        return make_response(400, {
            'error': 'Bad request',
            'message': 'Invalid JSON in request body'
        })
    except Exception as e:
        print(f"Error in confirm_uploads_handler: {e}")
        return make_response(500, {
            'error': 'Internal server error',
            'message': str(e)
        })


def lambda_handler(event, context):
    """
    Main entry point - routes to appropriate handler based on path.
    """
    path = event.get('path', '')
    http_method = event.get('httpMethod', '')

    # Handle routing
    if path.endswith('/upload-urls') and http_method == 'POST':
        return get_upload_urls_handler(event, context)
    elif path.endswith('/check-duplicates') and http_method == 'POST':
        return check_duplicates_handler(event, context)
    elif path.endswith('/confirm') and http_method == 'POST':
        return confirm_uploads_handler(event, context)
    else:
        return make_response(404, {
            'error': 'Not found',
            'message': f'Unknown endpoint: {http_method} {path}'
        })
