"""
Lambda function to list all mosaics with pagination support.
"""
import json
import os
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['MOSAICS_TABLE'])
cors_origin = os.environ['CORS_ORIGIN']


class DecimalEncoder(json.JSONEncoder):
    """Helper to convert DynamoDB Decimal types to JSON"""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super(DecimalEncoder, self).default(obj)


def lambda_handler(event, context):
    """
    GET /mosaics?limit=20&lastKey=<id>

    Returns list of mosaics with pagination.
    """
    try:
        # Get query parameters
        params = event.get('queryStringParameters') or {}
        limit = int(params.get('limit', 20))
        last_key = params.get('lastKey')

        # Build query parameters
        query_params = {
            'IndexName': 'by-created-at',
            'KeyConditionExpression': Key('is_main').eq(1),
            'ScanIndexForward': False,  # Newest first
            'Limit': limit
        }

        # Add pagination token if provided
        if last_key:
            query_params['ExclusiveStartKey'] = {
                'id': last_key,
                'is_main': 1
            }

        # Query the table
        response = table.query(**query_params)

        # Prepare response
        result = {
            'mosaics': response.get('Items', []),
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
        print(f"Error listing mosaics: {str(e)}")
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
