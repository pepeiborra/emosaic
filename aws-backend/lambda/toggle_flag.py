import json
import boto3
import time
import hashlib
from decimal import Decimal
from datetime import datetime, timedelta
import os

dynamodb = boto3.resource('dynamodb')
flags_table = dynamodb.Table(os.environ['TILE_FLAGS_TABLE'])
rate_limit_table = dynamodb.Table(os.environ['RATE_LIMIT_TABLE'])

def lambda_handler(event, context):
    """
    Toggle flag status for a tile
    POST /tiles/{tileHash}/flag - Flag a tile
    DELETE /tiles/{tileHash}/flag - Unflag a tile
    """
    
    try:
        # Extract request info
        http_method = event['httpMethod']
        tile_hash = event['pathParameters']['tileHash']
        
        # Get client IP for rate limiting
        client_ip = get_client_ip(event)
        
        # Parse request body
        body = {}
        if event.get('body'):
            body = json.loads(event['body'])
        
        tile_path = body.get('tilePath', '')
        
        # Check rate limit
        if not check_rate_limit(client_ip):
            return create_response(429, {
                'error': 'Rate limit exceeded',
                'message': 'Maximum 10 flags per minute'
            })
        
        if http_method == 'POST':
            # Flag the tile
            result = flag_tile(tile_hash, tile_path, client_ip)
            if result:
                consume_rate_limit(client_ip)
                return create_response(200, {
                    'success': True,
                    'action': 'flagged',
                    'tileHash': tile_hash
                })
            else:
                return create_response(400, {
                    'error': 'Tile already flagged',
                    'tileHash': tile_hash
                })
        
        elif http_method == 'DELETE':
            # Unflag the tile
            result = unflag_tile(tile_hash)
            return create_response(200, {
                'success': True,
                'action': 'unflagged',
                'tileHash': tile_hash
            })
        
        else:
            return create_response(405, {'error': 'Method not allowed'})
    
    except Exception as e:
        print(f"Error in toggle_flag: {str(e)}")
        return create_response(500, {'error': 'Internal server error'})

def get_client_ip(event):
    """Extract client IP from API Gateway event"""
    # Try various headers for IP address
    headers = event.get('headers', {})
    
    # Check CloudFront headers first
    ip = headers.get('CloudFront-Viewer-Address', '').split(':')[0]
    if ip:
        return ip
    
    # Check X-Forwarded-For
    forwarded_for = headers.get('X-Forwarded-For', '')
    if forwarded_for:
        return forwarded_for.split(',')[0].strip()
    
    # Check X-Real-IP
    real_ip = headers.get('X-Real-IP', '')
    if real_ip:
        return real_ip
    
    # Fallback to source IP
    return event.get('requestContext', {}).get('identity', {}).get('sourceIp', 'unknown')

def check_rate_limit(client_ip):
    """Check if client IP has exceeded rate limit (10 per minute)"""
    current_minute = int(time.time() / 60) * 60  # Round down to minute
    rate_key = f"{client_ip}:{current_minute}"
    
    try:
        response = rate_limit_table.get_item(Key={'ip_minute': rate_key})
        if 'Item' in response:
            return response['Item']['flag_count'] < 10
        return True  # No record = under limit
    except Exception as e:
        print(f"Error checking rate limit: {str(e)}")
        return True  # Allow on error

def consume_rate_limit(client_ip):
    """Increment rate limit counter"""
    current_minute = int(time.time() / 60) * 60
    rate_key = f"{client_ip}:{current_minute}"
    ttl = current_minute + 3600  # Expire after 1 hour
    
    try:
        rate_limit_table.update_item(
            Key={'ip_minute': rate_key},
            UpdateExpression='ADD flag_count :inc SET ttl = :ttl',
            ExpressionAttributeValues={
                ':inc': 1,
                ':ttl': ttl
            }
        )
    except Exception as e:
        print(f"Error updating rate limit: {str(e)}")

def flag_tile(tile_hash, tile_path, client_ip):
    """Flag a tile - returns True if successful, False if already flagged"""
    try:
        # Check if already flagged
        response = flags_table.get_item(Key={'tile_hash': tile_hash})
        if 'Item' in response:
            return False  # Already flagged
        
        # Add flag record
        ttl = int(time.time()) + (30 * 24 * 3600)  # 30 days TTL
        
        flags_table.put_item(
            Item={
                'tile_hash': tile_hash,
                'tile_path': tile_path,
                'flag_status': 'flagged',
                'flagged_at': datetime.utcnow().isoformat(),
                'flagged_by_ip': client_ip,
                'ttl': ttl
            }
        )
        return True
    except Exception as e:
        print(f"Error flagging tile: {str(e)}")
        raise

def unflag_tile(tile_hash):
    """Remove flag from tile"""
    try:
        flags_table.delete_item(Key={'tile_hash': tile_hash})
        return True
    except Exception as e:
        print(f"Error unflagging tile: {str(e)}")
        raise

def create_response(status_code, body):
    """Create API Gateway response with CORS headers"""
    cors_origin = os.environ.get('CORS_ORIGIN', '*')
    
    return {
        'statusCode': status_code,
        'headers': {
            'Access-Control-Allow-Origin': cors_origin,
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Content-Type': 'application/json'
        },
        'body': json.dumps(body, default=str)
    }