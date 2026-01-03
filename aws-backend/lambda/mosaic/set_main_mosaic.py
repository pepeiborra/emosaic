"""
Lambda function to set or unset a mosaic as the main mosaic.
Only one mosaic can be marked as main at a time.
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
    PUT /mosaics/{mosaicId}/main

    Sets the specified mosaic as the main mosaic.
    Unsets any previously main mosaic.

    Query parameter:
    - set_main=true (set as main) or set_main=false (unset as main)
    """
    try:
        # Get mosaic ID from path parameters
        mosaic_id = event['pathParameters']['mosaicId']

        # Get query parameters
        params = event.get('queryStringParameters') or {}
        set_main = params.get('set_main', 'true').lower() == 'true'

        # Check if mosaic exists
        response = table.get_item(Key={'id': mosaic_id})
        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': cors_origin,
                    'Access-Control-Allow-Credentials': 'true'
                },
                'body': json.dumps({
                    'error': 'Not found',
                    'message': f'Mosaic {mosaic_id} not found'
                })
            }

        if set_main:
            # First, find and unset any existing main mosaic
            # Query the by-created-at index to find current main mosaic
            existing_main = table.query(
                IndexName='by-created-at',
                KeyConditionExpression=Key('is_main').eq(1),
                Limit=1
            )

            if existing_main.get('Items'):
                for item in existing_main['Items']:
                    if item['id'] != mosaic_id:
                        # Unset the existing main mosaic
                        table.update_item(
                            Key={'id': item['id']},
                            UpdateExpression='SET is_main = :zero',
                            ExpressionAttributeValues={':zero': 0}
                        )
                        print(f"Unset main flag for mosaic {item['id']}")

            # Set the new main mosaic
            table.update_item(
                Key={'id': mosaic_id},
                UpdateExpression='SET is_main = :one',
                ExpressionAttributeValues={':one': 1}
            )

            message = f'Mosaic {mosaic_id} set as main'
            print(message)

        else:
            # Unset main flag
            table.update_item(
                Key={'id': mosaic_id},
                UpdateExpression='SET is_main = :zero',
                ExpressionAttributeValues={':zero': 0}
            )

            message = f'Mosaic {mosaic_id} unset as main'
            print(message)

        # Get updated mosaic
        updated_response = table.get_item(Key={'id': mosaic_id})

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps({
                'message': message,
                'mosaic': updated_response['Item']
            }, cls=DecimalEncoder)
        }

    except KeyError as e:
        return {
            'statusCode': 400,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps({
                'error': 'Bad request',
                'message': 'Missing required parameter: mosaicId'
            })
        }
    except Exception as e:
        print(f"Error setting main mosaic: {str(e)}")
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
