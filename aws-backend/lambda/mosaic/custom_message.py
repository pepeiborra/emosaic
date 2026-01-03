"""
Custom Message Lambda Trigger for Cognito

This Lambda customizes the messages sent by Cognito for:
- User invitation emails (AdminCreateUser)
- Forgot password emails
- Verification emails

The main purpose is to properly URL-encode credentials in invitation links
so that special characters in passwords don't break the URL.
"""

import urllib.parse


def lambda_handler(event, context):
    """
    Cognito Custom Message trigger handler.

    See: https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-custom-message.html
    """
    print(f"Custom message trigger: {event['triggerSource']}")

    # Get common attributes
    username = event['userName']
    code_parameter = event['request'].get('codeParameter', '')  # {####} replacement
    user_attributes = event['request'].get('userAttributes', {})
    email = user_attributes.get('email', username)

    # Base URL for admin panel
    admin_url = "https://casadelmanco.com/admin"

    if event['triggerSource'] == 'CustomMessage_AdminCreateUser':
        # Invitation email - URL-encode username and temporary password
        encoded_email = urllib.parse.quote(email, safe='')
        encoded_code = urllib.parse.quote(code_parameter, safe='')

        login_url = f"{admin_url}?u={encoded_email}&p={encoded_code}"

        event['response']['emailSubject'] = "Invitación al Panel de Administración - Casa del Manco"
        event['response']['emailMessage'] = f"""Has sido invitado/a al Panel de Administración de Casa del Manco.

Haz clic en el siguiente enlace para iniciar sesión:
{login_url}

Si el enlace no funciona, puedes iniciar sesión manualmente en {admin_url} con:
- Usuario: {email}
- Contraseña temporal: {code_parameter}

Esta contraseña temporal expira en 7 días."""

    elif event['triggerSource'] == 'CustomMessage_ForgotPassword':
        # Password reset email
        event['response']['emailSubject'] = "Código de verificación - Casa del Manco"
        event['response']['emailMessage'] = f"""Has solicitado restablecer tu contraseña en Casa del Manco.

Tu código de verificación es: {code_parameter}

Si no solicitaste este cambio, puedes ignorar este mensaje.

Saludos,
Casa del Manco"""

    elif event['triggerSource'] == 'CustomMessage_ResendCode':
        # Resend verification code
        encoded_email = urllib.parse.quote(email, safe='')
        encoded_code = urllib.parse.quote(code_parameter, safe='')

        login_url = f"{admin_url}?u={encoded_email}&p={encoded_code}"

        event['response']['emailSubject'] = "Invitación al Panel de Administración - Casa del Manco"
        event['response']['emailMessage'] = f"""Aquí tienes tu nueva invitación al Panel de Administración de Casa del Manco.

Haz clic en el siguiente enlace para iniciar sesión:
{login_url}

Si el enlace no funciona, puedes iniciar sesión manualmente en {admin_url} con:
- Usuario: {email}
- Contraseña temporal: {code_parameter}

Esta contraseña temporal expira en 7 días."""

    # Return the modified event
    return event
