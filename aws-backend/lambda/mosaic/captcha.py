"""
Captcha Lambda

Provides a self-hosted math-based captcha system:
- GET /captcha - Generate a new captcha challenge
"""

import json
import os
import uuid
import random
import time
import boto3
from botocore.exceptions import ClientError


# Initialize clients
dynamodb = boto3.resource('dynamodb')

# Environment variables
CAPTCHA_TABLE = os.environ.get('CAPTCHA_TABLE', 'prod-captcha')
CORS_ORIGIN = os.environ.get('CORS_ORIGIN', 'https://casadelmanco.com')

# Captcha settings
CAPTCHA_TTL_SECONDS = 300  # 5 minutes


def cors_headers():
    """Return CORS headers for responses."""
    return {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Content-Type': 'application/json'
    }


def response(status_code, body):
    """Create an API Gateway response."""
    return {
        'statusCode': status_code,
        'headers': cors_headers(),
        'body': json.dumps(body)
    }


def generate_captcha():
    """Generate a new math captcha challenge."""
    table = dynamodb.Table(CAPTCHA_TABLE)

    # Generate a simple math problem
    operations = [
        ('add', '+', lambda a, b: a + b),
        ('subtract', '-', lambda a, b: a - b),
        ('multiply', 'x', lambda a, b: a * b),
    ]

    op_name, op_symbol, op_func = random.choice(operations)

    # Keep numbers small for easy mental math
    if op_name == 'multiply':
        a = random.randint(2, 9)
        b = random.randint(2, 9)
    elif op_name == 'subtract':
        a = random.randint(10, 50)
        b = random.randint(1, a - 1)  # Ensure positive result
    else:  # add
        a = random.randint(1, 50)
        b = random.randint(1, 50)

    answer = op_func(a, b)
    question = f"{a} {op_symbol} {b} = ?"

    # Generate unique ID
    captcha_id = str(uuid.uuid4())
    expires_at = int(time.time()) + CAPTCHA_TTL_SECONDS

    # Store in DynamoDB
    table.put_item(Item={
        'id': captcha_id,
        'answer': str(answer),
        'expires_at': expires_at,
        'created_at': int(time.time())
    })

    return {
        'id': captcha_id,
        'question': question
    }


def verify_captcha(captcha_id, answer):
    """
    Verify a captcha answer.
    Returns True if valid, False otherwise.
    Deletes the captcha after verification (one-time use).
    """
    table = dynamodb.Table(CAPTCHA_TABLE)

    try:
        # Get the captcha
        result = table.get_item(Key={'id': captcha_id})
        item = result.get('Item')

        if not item:
            return False, 'Captcha not found or expired'

        # Check if expired
        if int(time.time()) > item.get('expires_at', 0):
            # Delete expired captcha
            table.delete_item(Key={'id': captcha_id})
            return False, 'Captcha expired'

        # Check answer
        stored_answer = item.get('answer', '')
        is_valid = str(answer).strip() == stored_answer

        # Delete captcha after use (one-time)
        table.delete_item(Key={'id': captcha_id})

        if is_valid:
            return True, 'Valid'
        else:
            return False, 'Incorrect answer'

    except ClientError as e:
        print(f"DynamoDB error: {e}")
        return False, 'Verification error'


def lambda_handler(event, context):
    """Main Lambda handler."""
    print(f"Event: {json.dumps(event)}")

    http_method = event.get('httpMethod', '')
    path = event.get('path', '')

    try:
        # GET /captcha - Generate new captcha
        if http_method == 'GET' and path == '/captcha':
            result = generate_captcha()
            return response(200, result)

        # OPTIONS - CORS preflight
        elif http_method == 'OPTIONS':
            return response(200, {})

        else:
            return response(404, {'error': 'Not found'})

    except Exception as e:
        print(f"Error: {str(e)}")
        return response(500, {'error': 'Internal server error'})
