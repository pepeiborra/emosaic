"""
User Management Lambda

Provides API endpoints for managing Cognito users:
- GET /users - List all users
- POST /users - Create a new user
- DELETE /users/{username} - Delete a user
- POST /users/{username}/resend-invite - Resend invitation email
- PUT /users/{username}/enable - Enable a user
- PUT /users/{username}/disable - Disable a user
"""

import json
import os
import boto3
from botocore.exceptions import ClientError


# Initialize clients
cognito = boto3.client('cognito-idp')

# Environment variables
USER_POOL_ID = os.environ.get('USER_POOL_ID')
CORS_ORIGIN = os.environ.get('CORS_ORIGIN', 'https://casadelmanco.com')


def cors_headers():
    """Return CORS headers for responses."""
    return {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Content-Type': 'application/json'
    }


def response(status_code, body):
    """Create an API Gateway response."""
    return {
        'statusCode': status_code,
        'headers': cors_headers(),
        'body': json.dumps(body)
    }


def list_users(limit=60):
    """List all users in the Cognito User Pool."""
    users = []
    pagination_token = None

    while len(users) < limit:
        params = {
            'UserPoolId': USER_POOL_ID,
            'Limit': min(limit - len(users), 60)
        }
        if pagination_token:
            params['PaginationToken'] = pagination_token

        result = cognito.list_users(**params)

        for user in result.get('Users', []):
            email = None
            for attr in user.get('Attributes', []):
                if attr['Name'] == 'email':
                    email = attr['Value']
                    break

            users.append({
                'username': user['Username'],
                'email': email,
                'status': user['UserStatus'],
                'enabled': user['Enabled'],
                'created': user['UserCreateDate'].isoformat() if user.get('UserCreateDate') else None,
                'modified': user['UserLastModifiedDate'].isoformat() if user.get('UserLastModifiedDate') else None,
            })

        pagination_token = result.get('PaginationToken')
        if not pagination_token:
            break

    return {
        'users': users,
        'count': len(users),
        'userPoolId': USER_POOL_ID
    }


def create_user(email, send_invite=True):
    """Create a new user in the Cognito User Pool."""
    try:
        params = {
            'UserPoolId': USER_POOL_ID,
            'Username': email,
            'UserAttributes': [
                {'Name': 'email', 'Value': email},
                {'Name': 'email_verified', 'Value': 'true'}
            ],
            'DesiredDeliveryMediums': ['EMAIL'] if send_invite else [],
        }

        result = cognito.admin_create_user(**params)
        user = result['User']

        return {
            'success': True,
            'username': user['Username'],
            'email': email,
            'status': user['UserStatus'],
            'message': f'User created successfully. Invitation email sent to {email}' if send_invite else 'User created successfully'
        }

    except cognito.exceptions.UsernameExistsException:
        return {
            'success': False,
            'email': email,
            'error': 'User already exists'
        }
    except Exception as e:
        return {
            'success': False,
            'email': email,
            'error': str(e)
        }


def delete_user(username):
    """Delete a user from the Cognito User Pool."""
    try:
        cognito.admin_delete_user(
            UserPoolId=USER_POOL_ID,
            Username=username
        )
        return {
            'success': True,
            'username': username,
            'message': 'User deleted successfully'
        }
    except cognito.exceptions.UserNotFoundException:
        return {
            'success': False,
            'username': username,
            'error': 'User not found'
        }
    except Exception as e:
        return {
            'success': False,
            'username': username,
            'error': str(e)
        }


def resend_invite(username):
    """Resend invitation email to a user."""
    try:
        cognito.admin_create_user(
            UserPoolId=USER_POOL_ID,
            Username=username,
            MessageAction='RESEND',
            DesiredDeliveryMediums=['EMAIL']
        )
        return {
            'success': True,
            'username': username,
            'message': 'Invitation email resent successfully'
        }
    except cognito.exceptions.UserNotFoundException:
        return {
            'success': False,
            'username': username,
            'error': 'User not found'
        }
    except cognito.exceptions.UnsupportedUserStateException:
        return {
            'success': False,
            'username': username,
            'error': 'User has already confirmed their account'
        }
    except Exception as e:
        return {
            'success': False,
            'username': username,
            'error': str(e)
        }


def enable_user(username):
    """Enable a disabled user."""
    try:
        cognito.admin_enable_user(
            UserPoolId=USER_POOL_ID,
            Username=username
        )
        return {
            'success': True,
            'username': username,
            'message': 'User enabled successfully'
        }
    except cognito.exceptions.UserNotFoundException:
        return {
            'success': False,
            'username': username,
            'error': 'User not found'
        }
    except Exception as e:
        return {
            'success': False,
            'username': username,
            'error': str(e)
        }


def disable_user(username):
    """Disable a user."""
    try:
        cognito.admin_disable_user(
            UserPoolId=USER_POOL_ID,
            Username=username
        )
        return {
            'success': True,
            'username': username,
            'message': 'User disabled successfully'
        }
    except cognito.exceptions.UserNotFoundException:
        return {
            'success': False,
            'username': username,
            'error': 'User not found'
        }
    except Exception as e:
        return {
            'success': False,
            'username': username,
            'error': str(e)
        }


def lambda_handler(event, context):
    """Main Lambda handler."""
    print(f"Event: {json.dumps(event)}")

    http_method = event.get('httpMethod', '')
    path = event.get('path', '')
    path_params = event.get('pathParameters') or {}

    try:
        # GET /users - List users
        if http_method == 'GET' and path == '/users':
            result = list_users()
            return response(200, result)

        # POST /users - Create user
        elif http_method == 'POST' and path == '/users':
            body = json.loads(event.get('body') or '{}')
            email = body.get('email')
            if not email:
                return response(400, {'error': 'Email is required'})
            send_invite = body.get('send_invite', True)
            result = create_user(email, send_invite)
            if result['success']:
                return response(201, result)
            else:
                return response(400, result)

        # DELETE /users/{username} - Delete user
        elif http_method == 'DELETE' and 'username' in path_params:
            username = path_params['username']
            result = delete_user(username)
            if result['success']:
                return response(200, result)
            else:
                return response(404 if result.get('error') == 'User not found' else 400, result)

        # POST /users/{username}/resend-invite - Resend invite
        elif http_method == 'POST' and 'username' in path_params and path.endswith('/resend-invite'):
            username = path_params['username']
            result = resend_invite(username)
            if result['success']:
                return response(200, result)
            else:
                return response(400, result)

        # PUT /users/{username}/enable - Enable user
        elif http_method == 'PUT' and 'username' in path_params and path.endswith('/enable'):
            username = path_params['username']
            result = enable_user(username)
            if result['success']:
                return response(200, result)
            else:
                return response(404 if result.get('error') == 'User not found' else 400, result)

        # PUT /users/{username}/disable - Disable user
        elif http_method == 'PUT' and 'username' in path_params and path.endswith('/disable'):
            username = path_params['username']
            result = disable_user(username)
            if result['success']:
                return response(200, result)
            else:
                return response(404 if result.get('error') == 'User not found' else 400, result)

        else:
            return response(404, {'error': 'Not found'})

    except json.JSONDecodeError:
        return response(400, {'error': 'Invalid JSON in request body'})
    except Exception as e:
        print(f"Error: {str(e)}")
        return response(500, {'error': 'Internal server error'})
