"""
Pre-Sign-Up Lambda Trigger for Cognito.

Auto-confirms users who sign up via an external identity provider
(Google, Facebook) and marks their email as verified, so they land
directly in the admin panel without an email-verification step.

For non-federated sign-ups (admin-create, regular SignUp API) the
event is returned unchanged and Cognito's default behavior applies.

Note: this does NOT link a federated identity to a pre-existing
native Cognito account with the same email. Such users will end up
with two separate accounts. Account linking via AdminLinkProviderForUser
is intentionally left out of scope here.
"""


def lambda_handler(event, context):
    trigger = event.get('triggerSource', '')
    print(f"Pre-Sign-Up trigger: {trigger}, user={event.get('userName')}")

    if trigger == 'PreSignUp_ExternalProvider':
        event['response']['autoConfirmUser'] = True
        event['response']['autoVerifyEmail'] = True

    return event
