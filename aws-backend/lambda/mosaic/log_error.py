"""
Lambda function to log client-side errors.
Stores error logs in DynamoDB for monitoring and investigation.
"""
import json
import os
import uuid
from datetime import datetime
from decimal import Decimal
import boto3

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['ERROR_LOGS_TABLE'])
cors_origin = os.environ['CORS_ORIGIN']


class DecimalEncoder(json.JSONEncoder):
    """Helper to convert DynamoDB Decimal types to JSON"""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super(DecimalEncoder, self).default(obj)


def lambda_handler(event, context):
    """
    POST /errors

    Logs a client-side error.

    Request body:
    {
        "category": "mosaic_creation",
        "severity": "error",
        "message": "Human-readable error message",
        "originalError": "Original error message",
        "stack": "Stack trace",
        "step": "get_upload_url",
        "context": { ... additional context ... },
        "timestamp": "ISO timestamp from client",
        "userAgent": "Browser user agent",
        "url": "Page URL",
        "user_email": "user@example.com" (optional)
    }
    """
    try:
        # Parse request body
        body = json.loads(event['body']) if event.get('body') else {}

        # Generate unique ID and server timestamp
        error_id = str(uuid.uuid4())
        server_timestamp = datetime.utcnow().isoformat() + 'Z'

        # Extract and validate required fields
        category = body.get('category', 'unknown')
        severity = body.get('severity', 'error')
        message = body.get('message', 'No message provided')

        # Build error log item
        item = {
            'id': error_id,
            'category': category,
            'severity': severity,
            'message': message,
            'client_timestamp': body.get('timestamp', server_timestamp),
            'server_timestamp': server_timestamp,
            # TTL: expire after 90 days (in seconds since epoch)
            'ttl': int((datetime.utcnow().timestamp()) + (90 * 24 * 60 * 60)),
        }

        # Optional fields
        if body.get('originalError'):
            item['original_error'] = body['originalError']
        if body.get('stack'):
            # Truncate stack traces to avoid DynamoDB item size limits
            item['stack'] = body['stack'][:4000]
        if body.get('step'):
            item['step'] = body['step']
        if body.get('context'):
            # Store context as JSON string to avoid DynamoDB type issues
            item['context'] = json.dumps(body['context'])[:4000]
        if body.get('userAgent'):
            item['user_agent'] = body['userAgent'][:500]
        if body.get('url'):
            item['url'] = body['url'][:1000]
        if body.get('user_email'):
            item['user_email'] = body['user_email']

        # Get user info from request context if available (from Cognito authorizer)
        request_context = event.get('requestContext', {})
        authorizer = request_context.get('authorizer', {})
        claims = authorizer.get('claims', {})
        if claims.get('email') and not item.get('user_email'):
            item['user_email'] = claims['email']
        if claims.get('sub'):
            item['user_id'] = claims['sub']

        # Store in DynamoDB
        table.put_item(Item=item)

        # Also log to CloudWatch for immediate visibility
        print(f"ERROR_LOG [{severity}] [{category}] {message}", {
            'error_id': error_id,
            'step': body.get('step'),
            'user_email': item.get('user_email'),
            'original_error': body.get('originalError'),
        })

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps({
                'success': True,
                'error_id': error_id
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
        # Log to CloudWatch even if DynamoDB fails
        print(f"Error logging client error: {str(e)}")
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
