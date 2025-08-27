import json
import boto3
from boto3.dynamodb.conditions import Attr
import os
from datetime import datetime
from decimal import Decimal

# Helper function to handle DynamoDB Decimal values
def decimal_default(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError

def lambda_handler(event, context):
    """
    Admin API to retrieve all flagged tiles
    GET /admin/flags?limit=100&lastKey=...
    """
    
    # CORS headers
    cors_headers = {
        'Access-Control-Allow-Origin': os.environ.get('CORS_ORIGIN', '*'),
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
    }
    
    try:
        # Handle CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': cors_headers,
                'body': json.dumps({'message': 'CORS preflight'}, default=decimal_default)
            }
        
        # Initialize DynamoDB
        dynamodb = boto3.resource('dynamodb')
        table_name = os.environ.get('TILE_FLAGS_TABLE')
        
        if not table_name:
            raise Exception('TILE_FLAGS_TABLE environment variable not set')
            
        table = dynamodb.Table(table_name)
        
        # Parse query parameters
        query_params = event.get('queryStringParameters') or {}
        limit = min(int(query_params.get('limit', 100)), 1000)  # Max 1000 items
        last_evaluated_key = query_params.get('lastKey')
        
        # Build scan parameters
        scan_params = {
            'Limit': limit,
            'FilterExpression': Attr('flag_status').eq('flagged')
        }
        
        # Add pagination if provided
        if last_evaluated_key:
            try:
                # Decode the lastKey (simple base64 or JSON)
                import base64
                decoded_key = json.loads(base64.b64decode(last_evaluated_key).decode('utf-8'))
                scan_params['ExclusiveStartKey'] = decoded_key
            except Exception as e:
                print(f"Failed to decode lastKey: {e}")
                # Continue without pagination
        
        # Scan the table for all flagged items
        response = table.scan(**scan_params)
        
        # Format the results
        flags = []
        for item in response.get('Items', []):
            flags.append({
                'tileHash': item.get('tile_hash'),
                'tilePath': item.get('tile_path'),
                'flaggedAt': item.get('flagged_at'),
                'flagStatus': item.get('flag_status', 'flagged'),
                'ttl': item.get('ttl'),  # TTL timestamp if present
            })
        
        # Sort by flagged_at descending (most recent first)
        flags.sort(key=lambda x: x.get('flaggedAt', ''), reverse=True)
        
        # Prepare pagination info
        result = {
            'success': True,
            'flags': flags,
            'count': len(flags),
            'scannedCount': response.get('ScannedCount', 0),
            'totalPages': None,  # Not available with scan
        }
        
        # Add pagination token if there are more results
        if 'LastEvaluatedKey' in response:
            import base64
            next_key = base64.b64encode(
                json.dumps(response['LastEvaluatedKey']).encode('utf-8')
            ).decode('utf-8')
            result['nextKey'] = next_key
            result['hasMore'] = True
        else:
            result['hasMore'] = False
        
        # Add summary statistics
        now = datetime.utcnow()
        today_count = 0
        week_count = 0
        
        for flag in flags:
            try:
                flag_date = datetime.fromisoformat(flag['flaggedAt'].replace('Z', '+00:00'))
                days_ago = (now - flag_date).days
                
                if days_ago == 0:
                    today_count += 1
                if days_ago <= 7:
                    week_count += 1
            except:
                continue
        
        result['summary'] = {
            'total': len(flags),
            'today': today_count,
            'thisWeek': week_count,
            'retrievedAt': now.isoformat() + 'Z'
        }
        
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps(result, default=decimal_default)
        }
        
    except Exception as e:
        print(f"Error in admin_get_all_flags: {str(e)}")
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': 'Internal server error',
                'message': str(e)
            }, default=decimal_default)
        }