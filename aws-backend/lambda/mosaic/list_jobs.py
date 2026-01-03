"""
Lambda function to list jobs with optional filtering and pagination.
"""
import json
import os
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['JOBS_TABLE'])
cors_origin = os.environ['CORS_ORIGIN']


class DecimalEncoder(json.JSONEncoder):
    """Helper to convert DynamoDB Decimal types to JSON"""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super(DecimalEncoder, self).default(obj)


def lambda_handler(event, context):
    """
    GET /jobs?status=<status>&mosaic_id=<id>&limit=20&lastKey=<key>

    Lists jobs with optional filtering by status or mosaic_id.
    Supports pagination.
    """
    try:
        # Get query parameters
        params = event.get('queryStringParameters') or {}
        limit = int(params.get('limit', 20))
        last_key = params.get('lastKey')
        status_filter = params.get('status')  # pending, submitted, succeeded, failed
        mosaic_id = params.get('mosaic_id')

        # Build query based on filters
        if mosaic_id:
            # Query by mosaic_id using GSI
            query_params = {
                'IndexName': 'by-mosaic-id',
                'KeyConditionExpression': Key('mosaic_id').eq(mosaic_id),
                'ScanIndexForward': False,  # Newest first
                'Limit': limit
            }

            if last_key:
                query_params['ExclusiveStartKey'] = {
                    'id': last_key,
                    'mosaic_id': mosaic_id
                }

            response = table.query(**query_params)

        elif status_filter:
            # Query by status using GSI
            query_params = {
                'IndexName': 'by-status',
                'KeyConditionExpression': Key('status').eq(status_filter),
                'ScanIndexForward': False,  # Newest first
                'Limit': limit
            }

            if last_key:
                query_params['ExclusiveStartKey'] = {
                    'id': last_key,
                    'status': status_filter
                }

            response = table.query(**query_params)

        else:
            # Scan all jobs (no filter)
            scan_params = {
                'Limit': limit
            }

            if last_key:
                scan_params['ExclusiveStartKey'] = {'id': last_key}

            response = table.scan(**scan_params)

        # Prepare response
        result = {
            'jobs': response.get('Items', []),
            'count': len(response.get('Items', []))
        }

        # Add pagination token if there are more results
        if 'LastEvaluatedKey' in response:
            result['lastKey'] = response['LastEvaluatedKey']['id']

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps(result, cls=DecimalEncoder)
        }

    except Exception as e:
        print(f"Error listing jobs: {str(e)}")
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
