"""
Lambda function to list error logs for monitoring and investigation.
"""
import json
import os
from datetime import datetime, timedelta
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key, Attr

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
    GET /errors

    Lists error logs with optional filtering.

    Query parameters:
    - limit: Maximum number of results (default 50, max 200)
    - category: Filter by error category (e.g., 'mosaic_creation')
    - severity: Filter by severity ('error', 'warning', 'info')
    - since: ISO timestamp - only show errors after this time
    - lastKey: Pagination key from previous request
    """
    try:
        # Parse query parameters
        params = event.get('queryStringParameters') or {}
        limit = min(int(params.get('limit', 50)), 200)
        category = params.get('category')
        severity = params.get('severity')
        since = params.get('since')
        last_key = params.get('lastKey')

        # Build scan parameters
        scan_kwargs = {
            'Limit': limit,
        }

        # Build filter expression
        filter_expressions = []
        expression_values = {}
        expression_names = {}

        if category:
            filter_expressions.append('#category = :category')
            expression_values[':category'] = category
            expression_names['#category'] = 'category'

        if severity:
            filter_expressions.append('severity = :severity')
            expression_values[':severity'] = severity

        if since:
            filter_expressions.append('server_timestamp >= :since')
            expression_values[':since'] = since

        if filter_expressions:
            scan_kwargs['FilterExpression'] = ' AND '.join(filter_expressions)
            scan_kwargs['ExpressionAttributeValues'] = expression_values
            if expression_names:
                scan_kwargs['ExpressionAttributeNames'] = expression_names

        if last_key:
            scan_kwargs['ExclusiveStartKey'] = json.loads(last_key)

        # Perform scan
        response = table.scan(**scan_kwargs)

        # Sort by server_timestamp descending (most recent first)
        items = response.get('Items', [])
        items.sort(key=lambda x: x.get('server_timestamp', ''), reverse=True)

        # Parse context JSON back to objects
        for item in items:
            if 'context' in item and isinstance(item['context'], str):
                try:
                    item['context'] = json.loads(item['context'])
                except json.JSONDecodeError:
                    pass  # Keep as string if not valid JSON

        result = {
            'errors': items,
            'count': len(items),
        }

        if response.get('LastEvaluatedKey'):
            result['lastKey'] = json.dumps(response['LastEvaluatedKey'])

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
        print(f"Error listing error logs: {str(e)}")
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
