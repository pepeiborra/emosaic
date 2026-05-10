"""
Post-Confirmation Lambda Trigger for Cognito.

Fires after a user has been confirmed — for federated users (Google,
Facebook), this happens immediately after the Pre-Sign-Up trigger
auto-confirms them, so this trigger is effectively a "new federated
user just signed up" hook.

Sends an SES email to the configured admin address so they can
disable the account if it shouldn't have access. This is the
reactive moderation gate that replaces upfront admin approval.
"""

import os
import boto3
from botocore.exceptions import ClientError


ses = boto3.client('ses')

ADMIN_NOTIFICATION_EMAIL = os.environ.get('ADMIN_NOTIFICATION_EMAIL', '')
ADMIN_EMAIL_FROM = os.environ.get('ADMIN_EMAIL_FROM', 'noreply@casadelmanco.com')
ADMIN_PANEL_URL = os.environ.get('ADMIN_PANEL_URL', 'https://casadelmanco.com/admin')


def lambda_handler(event, context):
    trigger = event.get('triggerSource', '')
    print(f"Post-Confirmation trigger: {trigger}, user={event.get('userName')}")

    if trigger != 'PostConfirmation_ConfirmSignUp':
        return event

    if not ADMIN_NOTIFICATION_EMAIL:
        print("ADMIN_NOTIFICATION_EMAIL not configured; skipping notification")
        return event

    attrs = event.get('request', {}).get('userAttributes', {}) or {}
    user_email = attrs.get('email', '(unknown)')
    user_name = attrs.get('name', '(unnamed)')
    provider = _identity_provider_from_username(event.get('userName', ''))

    subject = f"Nuevo acceso al Panel de Administracion: {user_email}"
    body_text = f"""Un nuevo usuario acaba de iniciar sesion por primera vez en el Panel de Administracion de Casa del Manco.

Nombre: {user_name}
Email: {user_email}
Proveedor: {provider}

Si NO reconoces a este usuario, ve al panel y deshabilita la cuenta:
{ADMIN_PANEL_URL}/users

---
Notificacion automatica."""

    body_html = f"""<html>
<body>
<p>Un nuevo usuario acaba de iniciar sesion por primera vez en el Panel de Administracion de Casa del Manco.</p>
<ul>
  <li><strong>Nombre:</strong> {user_name}</li>
  <li><strong>Email:</strong> {user_email}</li>
  <li><strong>Proveedor:</strong> {provider}</li>
</ul>
<p>Si NO reconoces a este usuario, <a href="{ADMIN_PANEL_URL}/users">ve al panel y deshabilita la cuenta</a>.</p>
<hr>
<p><small>Notificacion automatica.</small></p>
</body>
</html>"""

    try:
        ses.send_email(
            Source=ADMIN_EMAIL_FROM,
            Destination={'ToAddresses': [ADMIN_NOTIFICATION_EMAIL]},
            Message={
                'Subject': {'Data': subject, 'Charset': 'UTF-8'},
                'Body': {
                    'Text': {'Data': body_text, 'Charset': 'UTF-8'},
                    'Html': {'Data': body_html, 'Charset': 'UTF-8'},
                },
            },
        )
        print(f"Notification sent to {ADMIN_NOTIFICATION_EMAIL}")
    except ClientError as e:
        print(f"Failed to send notification: {e}")

    return event


def _identity_provider_from_username(username):
    """Cognito federated usernames are prefixed: 'Google_123...', 'Facebook_456...'."""
    if username.startswith('Google_'):
        return 'Google'
    if username.startswith('Facebook_'):
        return 'Facebook'
    return 'Cognito (email/password)'
