import json
import boto3
import os
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
flags_table = dynamodb.Table(os.environ['TILE_FLAGS_TABLE'])

def lambda_handler(event, context):
    """
    Get flag status for multiple tiles
    POST /tiles/flags
    Body: {"tileHashes": ["hash1", "hash2", ...]}
    """

    try:
        # Parse request body
        if not event.get('body'):
            return create_response(400, {'error': 'Request body required'})

        body = json.loads(event['body'])
        tile_hashes = body.get('tileHashes', [])

        if not tile_hashes:
            return create_response(400, {'error': 'tileHashes array required'})

        if len(tile_hashes) > 100:  # Limit batch size
            return create_response(400, {'error': 'Maximum 100 tile hashes per request'})

        # Get flag status for all tiles
        flags = get_tile_flags(tile_hashes)

        return create_response(200, {
            'success': True,
            'flags': flags,
            'count': len(flags)
        })

    except json.JSONDecodeError:
        return create_response(400, {'error': 'Invalid JSON in request body'})
    except Exception as e:
        print(f"Error in get_flags: {str(e)}")
        return create_response(500, {'error': 'Internal server error'})

def get_tile_flags(tile_hashes):
    """Get flag information for multiple tile hashes"""
    flags = {}

    try:
        # Use batch_get_item for efficient retrieval
        # DynamoDB batch_get_item has a limit of 100 items

        request_items = {
            flags_table.name: {
                'Keys': [{'tile_hash': tile_hash} for tile_hash in tile_hashes]
            }
        }

        response = dynamodb.batch_get_item(RequestItems=request_items)

        # Process retrieved items
        for item in response.get('Responses', {}).get(flags_table.name, []):
            tile_hash = item['tile_hash']
            flags[tile_hash] = {
                'flagged': True,
                'flaggedAt': item.get('flagged_at', ''),
                'flagStatus': item.get('flag_status', 'flagged'),
                'tilePath': item.get('tile_path', '')
            }

        # Handle unprocessed keys (if any)
        unprocessed = response.get('UnprocessedKeys', {})
        if unprocessed:
            print(f"Warning: {len(unprocessed)} unprocessed keys")
            # Could implement retry logic here

        return flags

    except Exception as e:
        print(f"Error getting tile flags: {str(e)}")
        raise

def get_single_flag(tile_hash):
    """Get flag status for a single tile"""
    try:
        response = flags_table.get_item(Key={'tile_hash': tile_hash})

        if 'Item' in response:
            item = response['Item']
            return {
                'flagged': True,
                'flaggedAt': item.get('flagged_at', ''),
                'flagStatus': item.get('flag_status', 'flagged'),
                'tilePath': item.get('tile_path', '')
            }

        return None  # Not flagged

    except Exception as e:
        print(f"Error getting single flag: {str(e)}")
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