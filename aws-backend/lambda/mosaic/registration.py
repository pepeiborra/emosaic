"""
Registration Lambda

Provides API endpoints for user self-registration with admin approval:
- POST /register - Submit a new registration request (public)
- GET /registrations - List pending registrations (admin)
- POST /registrations/{id}/approve - Approve a registration (admin)
- POST /registrations/{id}/reject - Reject a registration (admin)
"""

import json
import os
import uuid
import time
import re
import boto3
from botocore.exceptions import ClientError

# Import captcha verification
from captcha import verify_captcha


# Initialize clients
dynamodb = boto3.resource('dynamodb')
cognito = boto3.client('cognito-idp')
ses = boto3.client('ses')

# Environment variables
PENDING_REGISTRATIONS_TABLE = os.environ.get('PENDING_REGISTRATIONS_TABLE', 'prod-pending-registrations')
CAPTCHA_TABLE = os.environ.get('CAPTCHA_TABLE', 'prod-captcha')
USER_POOL_ID = os.environ.get('USER_POOL_ID')
CORS_ORIGIN = os.environ.get('CORS_ORIGIN', 'https://casadelmanco.com')
ADMIN_EMAIL_FROM = os.environ.get('ADMIN_EMAIL_FROM', 'noreply@casadelmanco.com')
ADMIN_PANEL_URL = os.environ.get('ADMIN_PANEL_URL', 'https://casadelmanco.com/admin')

# Registration settings
REGISTRATION_TTL_DAYS = 30


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


def validate_email(email):
    """Validate email format."""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None


def validate_name(name):
    """Validate name (2-100 chars, letters and spaces)."""
    if not name or len(name) < 2 or len(name) > 100:
        return False
    # Allow letters, spaces, hyphens, apostrophes
    pattern = r"^[a-zA-ZàáâäãåąčćęèéêëėįìíîïłńòóôöõøùúûüųūÿýżźñçčšžÀÁÂÄÃÅĄĆČĖĘÈÉÊËÌÍÎÏĮŁŃÒÓÔÖÕØÙÚÛÜŲŪŸÝŻŹÑßÇŒÆČŠŽ∂ð ,.'\\-]+$"
    return re.match(pattern, name) is not None


def email_exists_in_cognito(email):
    """Check if email already exists in Cognito."""
    try:
        result = cognito.list_users(
            UserPoolId=USER_POOL_ID,
            Filter=f'email = "{email}"',
            Limit=1
        )
        return len(result.get('Users', [])) > 0
    except ClientError:
        return False


def email_has_pending_registration(email):
    """Check if email has a pending registration."""
    table = dynamodb.Table(PENDING_REGISTRATIONS_TABLE)
    try:
        result = table.query(
            IndexName='by-status',
            KeyConditionExpression='#status = :status',
            FilterExpression='email = :email',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'PENDING',
                ':email': email.lower()
            }
        )
        return len(result.get('Items', [])) > 0
    except ClientError:
        return False


def get_admin_emails():
    """Get email addresses of all admin users."""
    emails = []
    try:
        result = cognito.list_users(
            UserPoolId=USER_POOL_ID,
            Limit=60
        )
        for user in result.get('Users', []):
            if user.get('Enabled', False):
                for attr in user.get('Attributes', []):
                    if attr['Name'] == 'email':
                        emails.append(attr['Value'])
                        break
    except ClientError as e:
        print(f"Error fetching admin emails: {e}")
    return emails


def send_admin_notification(registration):
    """Send email notification to admins about new registration."""
    admin_emails = get_admin_emails()
    if not admin_emails:
        print("No admin emails found")
        return

    subject = "Nueva solicitud de registro - Casa del Manco"
    body_text = f"""Se ha recibido una nueva solicitud de registro:

Nombre: {registration['name']}
Email: {registration['email']}
Fecha: {registration['created_at']}

Para aprobar o rechazar esta solicitud, accede al panel de administración:
{ADMIN_PANEL_URL}

---
Este es un mensaje automático."""

    body_html = f"""<html>
<body>
<h2>Nueva solicitud de registro</h2>
<p>Se ha recibido una nueva solicitud de registro:</p>
<ul>
<li><strong>Nombre:</strong> {registration['name']}</li>
<li><strong>Email:</strong> {registration['email']}</li>
<li><strong>Fecha:</strong> {registration['created_at']}</li>
</ul>
<p><a href="{ADMIN_PANEL_URL}">Acceder al panel de administración</a></p>
<hr>
<p><small>Este es un mensaje automático.</small></p>
</body>
</html>"""

    for admin_email in admin_emails:
        try:
            ses.send_email(
                Source=ADMIN_EMAIL_FROM,
                Destination={'ToAddresses': [admin_email]},
                Message={
                    'Subject': {'Data': subject, 'Charset': 'UTF-8'},
                    'Body': {
                        'Text': {'Data': body_text, 'Charset': 'UTF-8'},
                        'Html': {'Data': body_html, 'Charset': 'UTF-8'}
                    }
                }
            )
            print(f"Notification sent to {admin_email}")
        except ClientError as e:
            print(f"Failed to send email to {admin_email}: {e}")


def submit_registration(email, name, captcha_id, captcha_answer):
    """Submit a new registration request."""
    table = dynamodb.Table(PENDING_REGISTRATIONS_TABLE)

    # Validate inputs
    email = email.strip().lower()
    name = name.strip()

    if not validate_email(email):
        return {'success': False, 'error': 'Invalid email format'}

    if not validate_name(name):
        return {'success': False, 'error': 'Invalid name (2-100 characters, letters only)'}

    # Verify captcha
    is_valid, captcha_error = verify_captcha(captcha_id, captcha_answer)
    if not is_valid:
        return {'success': False, 'error': f'Captcha verification failed: {captcha_error}'}

    # Check if email already exists in Cognito
    if email_exists_in_cognito(email):
        return {'success': False, 'error': 'Email already registered'}

    # Check if email has pending registration
    if email_has_pending_registration(email):
        return {'success': False, 'error': 'Registration already pending for this email'}

    # Create registration record
    registration_id = str(uuid.uuid4())
    created_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    expires_at = int(time.time()) + (REGISTRATION_TTL_DAYS * 24 * 60 * 60)

    registration = {
        'id': registration_id,
        'email': email,
        'name': name,
        'status': 'PENDING',
        'created_at': created_at,
        'expires_at': expires_at
    }

    table.put_item(Item=registration)

    # Send notification to admins
    try:
        send_admin_notification(registration)
    except Exception as e:
        print(f"Failed to send admin notification: {e}")
        # Don't fail the registration if notification fails

    return {
        'success': True,
        'message': 'Registration submitted successfully. You will receive an email when your request is reviewed.'
    }


def list_pending_registrations():
    """List all pending registration requests."""
    table = dynamodb.Table(PENDING_REGISTRATIONS_TABLE)

    try:
        result = table.query(
            IndexName='by-status',
            KeyConditionExpression='#status = :status',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={':status': 'PENDING'},
            ScanIndexForward=False  # Most recent first
        )

        registrations = []
        for item in result.get('Items', []):
            registrations.append({
                'id': item['id'],
                'email': item['email'],
                'name': item['name'],
                'created_at': item['created_at'],
                'status': item['status']
            })

        return {
            'registrations': registrations,
            'count': len(registrations)
        }
    except ClientError as e:
        print(f"Error listing registrations: {e}")
        return {'registrations': [], 'count': 0, 'error': str(e)}


def approve_registration(registration_id):
    """Approve a registration and create Cognito user."""
    table = dynamodb.Table(PENDING_REGISTRATIONS_TABLE)

    try:
        # Get the registration
        result = table.get_item(Key={'id': registration_id})
        item = result.get('Item')

        if not item:
            return {'success': False, 'error': 'Registration not found'}

        if item['status'] != 'PENDING':
            return {'success': False, 'error': f"Registration already {item['status'].lower()}"}

        email = item['email']
        name = item['name']

        # Create Cognito user
        try:
            cognito.admin_create_user(
                UserPoolId=USER_POOL_ID,
                Username=email,
                UserAttributes=[
                    {'Name': 'email', 'Value': email},
                    {'Name': 'email_verified', 'Value': 'true'},
                    {'Name': 'name', 'Value': name}
                ],
                DesiredDeliveryMediums=['EMAIL']
            )
        except cognito.exceptions.UsernameExistsException:
            # User already exists, update status anyway
            pass

        # Update registration status
        table.update_item(
            Key={'id': registration_id},
            UpdateExpression='SET #status = :status, approved_at = :approved_at',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'APPROVED',
                ':approved_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            }
        )

        return {
            'success': True,
            'message': f'Registration approved. Invitation email sent to {email}'
        }

    except ClientError as e:
        print(f"Error approving registration: {e}")
        return {'success': False, 'error': str(e)}


def reject_registration(registration_id):
    """Reject a registration."""
    table = dynamodb.Table(PENDING_REGISTRATIONS_TABLE)

    try:
        # Get the registration
        result = table.get_item(Key={'id': registration_id})
        item = result.get('Item')

        if not item:
            return {'success': False, 'error': 'Registration not found'}

        if item['status'] != 'PENDING':
            return {'success': False, 'error': f"Registration already {item['status'].lower()}"}

        # Update registration status
        table.update_item(
            Key={'id': registration_id},
            UpdateExpression='SET #status = :status, rejected_at = :rejected_at',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'REJECTED',
                ':rejected_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            }
        )

        return {
            'success': True,
            'message': 'Registration rejected'
        }

    except ClientError as e:
        print(f"Error rejecting registration: {e}")
        return {'success': False, 'error': str(e)}


def lambda_handler(event, context):
    """Main Lambda handler."""
    print(f"Event: {json.dumps(event)}")

    http_method = event.get('httpMethod', '')
    path = event.get('path', '')
    path_params = event.get('pathParameters') or {}

    try:
        # POST /register - Submit registration (public)
        if http_method == 'POST' and path == '/register':
            body = json.loads(event.get('body') or '{}')
            email = body.get('email', '')
            name = body.get('name', '')
            captcha_id = body.get('captcha_id', '')
            captcha_answer = body.get('captcha_answer', '')

            if not email or not name:
                return response(400, {'error': 'Email and name are required'})
            if not captcha_id or not captcha_answer:
                return response(400, {'error': 'Captcha is required'})

            result = submit_registration(email, name, captcha_id, captcha_answer)
            if result['success']:
                return response(201, result)
            else:
                return response(400, result)

        # GET /registrations - List pending (admin)
        elif http_method == 'GET' and path == '/registrations':
            result = list_pending_registrations()
            return response(200, result)

        # POST /registrations/{id}/approve - Approve (admin)
        elif http_method == 'POST' and 'id' in path_params and path.endswith('/approve'):
            registration_id = path_params['id']
            result = approve_registration(registration_id)
            if result['success']:
                return response(200, result)
            else:
                return response(400, result)

        # POST /registrations/{id}/reject - Reject (admin)
        elif http_method == 'POST' and 'id' in path_params and path.endswith('/reject'):
            registration_id = path_params['id']
            result = reject_registration(registration_id)
            if result['success']:
                return response(200, result)
            else:
                return response(400, result)

        # OPTIONS - CORS preflight
        elif http_method == 'OPTIONS':
            return response(200, {})

        else:
            return response(404, {'error': 'Not found'})

    except json.JSONDecodeError:
        return response(400, {'error': 'Invalid JSON in request body'})
    except Exception as e:
        print(f"Error: {str(e)}")
        return response(500, {'error': 'Internal server error'})
