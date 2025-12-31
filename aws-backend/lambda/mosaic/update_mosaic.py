"""
Lambda function to update an existing mosaic.
"""
import json
import os
from datetime import datetime
from decimal import Decimal
import boto3

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
    PUT /mosaics/{mosaicId}

    Updates an existing mosaic.

    Request body can include any updatable fields:
    {
        "title": "Updated Title",
        "description": "Updated description",
        "status": "completed"
    }
    """
    try:
        # Get mosaic ID from path parameters
        mosaic_id = event['pathParameters']['mosaicId']

        # Parse request body
        body = json.loads(event['body'])

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

        # Build update expression
        update_expr_parts = []
        expr_attr_names = {}
        expr_attr_values = {}

        # Updatable fields
        updatable_fields = [
            'title', 'description', 'tile_size', 'mode',
            'tint_opacity', 'is_main', 'status',
            'source_image_path', 'output_path', 'tiles_dir'
        ]

        for field in updatable_fields:
            if field in body:
                update_expr_parts.append(f'#{field} = :{field}')
                expr_attr_names[f'#{field}'] = field

                # Convert tint_opacity to Decimal
                if field == 'tint_opacity':
                    expr_attr_values[f':{field}'] = Decimal(str(body[field]))
                # Convert is_main to 1/0
                elif field == 'is_main':
                    expr_attr_values[f':{field}'] = 1 if body[field] else 0
                else:
                    expr_attr_values[f':{field}'] = body[field]

        # Always update updated_at timestamp
        update_expr_parts.append('#updated_at = :updated_at')
        expr_attr_names['#updated_at'] = 'updated_at'
        expr_attr_values[':updated_at'] = datetime.utcnow().isoformat() + 'Z'

        if not update_expr_parts:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': cors_origin,
                    'Access-Control-Allow-Credentials': 'true'
                },
                'body': json.dumps({
                    'error': 'Bad request',
                    'message': 'No updatable fields provided'
                })
            }

        # Perform update
        update_expr = 'SET ' + ', '.join(update_expr_parts)
        response = table.update_item(
            Key={'id': mosaic_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_attr_names,
            ExpressionAttributeValues=expr_attr_values,
            ReturnValues='ALL_NEW'
        )

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': json.dumps(response['Attributes'], cls=DecimalEncoder)
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
        print(f"Error updating mosaic: {str(e)}")
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
