#!/usr/bin/env python3
"""
Cognito User Management CLI

A command-line interface for managing admin users in the emosaic Cognito User Pool.
Provides commands to list, create, and delete users.
"""

import json
import boto3
import click
from typing import Optional, Dict, Any, List


class UserManager:
    """Manages interactions with the Cognito User Pool."""

    def __init__(self, environment: str = 'prod', region: str = 'eu-west-3'):
        self.environment = environment
        self.region = region

        # Initialize clients
        self.cognito = boto3.client('cognito-idp', region_name=region)
        self.cloudformation = boto3.client('cloudformation', region_name=region)

        # Get User Pool ID from CloudFormation stack
        self.user_pool_id = self._get_user_pool_id()

    def _get_user_pool_id(self) -> str:
        """Get User Pool ID from CloudFormation stack outputs."""
        stack_name = f"{self.environment}-mosaic-infrastructure"

        try:
            response = self.cloudformation.describe_stacks(StackName=stack_name)
            outputs = response['Stacks'][0]['Outputs']

            for output in outputs:
                if output['OutputKey'] == 'UserPoolId':
                    return output['OutputValue']

            raise ValueError(f"UserPoolId not found in stack {stack_name} outputs")
        except self.cloudformation.exceptions.ClientError as e:
            raise ValueError(f"Could not find stack {stack_name}: {e}")

    def list_users(self, limit: int = 60) -> Dict[str, Any]:
        """
        List all users in the Cognito User Pool.

        Args:
            limit: Maximum number of users to return

        Returns:
            Dict containing users and count
        """
        users = []
        pagination_token = None

        while True:
            params = {
                'UserPoolId': self.user_pool_id,
                'Limit': min(limit - len(users), 60)  # Cognito max is 60
            }
            if pagination_token:
                params['PaginationToken'] = pagination_token

            response = self.cognito.list_users(**params)

            for user in response.get('Users', []):
                # Extract email from attributes
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

            # Check for more pages
            pagination_token = response.get('PaginationToken')
            if not pagination_token or len(users) >= limit:
                break

        return {
            'users': users,
            'count': len(users),
            'userPoolId': self.user_pool_id
        }

    def create_user(self, email: str, send_invite: bool = True) -> Dict[str, Any]:
        """
        Create a new user in the Cognito User Pool.

        Args:
            email: User's email address (also used as username)
            send_invite: Whether to send an email invitation with temporary password

        Returns:
            Dict with user details and status
        """
        try:
            # Create user with email as username
            params = {
                'UserPoolId': self.user_pool_id,
                'Username': email,
                'UserAttributes': [
                    {'Name': 'email', 'Value': email},
                    {'Name': 'email_verified', 'Value': 'true'}
                ],
                'DesiredDeliveryMediums': ['EMAIL'] if send_invite else [],
            }

            if send_invite:
                # Let Cognito generate and send temporary password
                params['MessageAction'] = 'SUPPRESS'  # We'll resend below for better control
            else:
                # Generate a temporary password that user must change
                import secrets
                import string
                temp_password = ''.join(secrets.choice(string.ascii_letters + string.digits + '!@#$%^&*') for _ in range(16))
                params['TemporaryPassword'] = temp_password

            response = self.cognito.admin_create_user(**params)
            user = response['User']

            # If send_invite, trigger the invitation email
            if send_invite:
                try:
                    self.cognito.admin_create_user(
                        UserPoolId=self.user_pool_id,
                        Username=email,
                        MessageAction='RESEND'
                    )
                except self.cognito.exceptions.UserNotFoundException:
                    pass  # User exists, invitation already sent
                except self.cognito.exceptions.UnsupportedUserStateException:
                    pass  # User already confirmed, no need to resend

            result = {
                'success': True,
                'username': user['Username'],
                'email': email,
                'status': user['UserStatus'],
                'message': 'User created successfully'
            }

            if send_invite:
                result['message'] += f'. Invitation email sent to {email}'
            elif not send_invite and 'temp_password' in locals():
                result['temporaryPassword'] = temp_password
                result['message'] += '. User must change password on first login'

            return result

        except self.cognito.exceptions.UsernameExistsException:
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

    def delete_user(self, username: str) -> Dict[str, Any]:
        """
        Delete a user from the Cognito User Pool.

        Args:
            username: Username (email) to delete

        Returns:
            Dict with deletion status
        """
        try:
            self.cognito.admin_delete_user(
                UserPoolId=self.user_pool_id,
                Username=username
            )
            return {
                'success': True,
                'username': username,
                'message': 'User deleted successfully'
            }
        except self.cognito.exceptions.UserNotFoundException:
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

    def resend_invite(self, username: str) -> Dict[str, Any]:
        """
        Resend invitation email to a user.

        Args:
            username: Username (email) to resend invite to

        Returns:
            Dict with status
        """
        try:
            self.cognito.admin_create_user(
                UserPoolId=self.user_pool_id,
                Username=username,
                MessageAction='RESEND',
                DesiredDeliveryMediums=['EMAIL']
            )
            return {
                'success': True,
                'username': username,
                'message': 'Invitation email resent successfully'
            }
        except self.cognito.exceptions.UserNotFoundException:
            return {
                'success': False,
                'username': username,
                'error': 'User not found'
            }
        except self.cognito.exceptions.UnsupportedUserStateException:
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

    def enable_user(self, username: str) -> Dict[str, Any]:
        """Enable a disabled user."""
        try:
            self.cognito.admin_enable_user(
                UserPoolId=self.user_pool_id,
                Username=username
            )
            return {
                'success': True,
                'username': username,
                'message': 'User enabled successfully'
            }
        except self.cognito.exceptions.UserNotFoundException:
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

    def disable_user(self, username: str) -> Dict[str, Any]:
        """Disable a user (prevents login without deleting)."""
        try:
            self.cognito.admin_disable_user(
                UserPoolId=self.user_pool_id,
                Username=username
            )
            return {
                'success': True,
                'username': username,
                'message': 'User disabled successfully'
            }
        except self.cognito.exceptions.UserNotFoundException:
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


# CLI Commands
@click.group()
@click.option('--environment', '-e', default='prod', help='Environment (prod, staging, etc.)')
@click.option('--region', '-r', default='eu-west-3', help='AWS region')
@click.pass_context
def cli(ctx, environment, region):
    """Cognito User Management CLI - Manage admin users for the emosaic system."""
    ctx.ensure_object(dict)
    try:
        ctx.obj['manager'] = UserManager(environment=environment, region=region)
    except ValueError as e:
        click.echo(f"Error: {e}", err=True)
        raise click.Abort()


@cli.command('list')
@click.option('--format', '-f', type=click.Choice(['table', 'json']), default='table', help='Output format')
@click.pass_context
def list_users(ctx, format):
    """List all users in the Cognito User Pool."""
    manager = ctx.obj['manager']

    try:
        result = manager.list_users()

        if format == 'json':
            click.echo(json.dumps(result, indent=2, default=str))
            return

        # Table format
        users = result['users']
        click.echo(f"\n👤 Users in pool: {result['userPoolId']}")
        click.echo(f"   Total: {result['count']}")
        click.echo("─" * 100)
        click.echo(f"{'Email':<40} {'Status':<20} {'Enabled':<10} {'Created':<25}")
        click.echo("─" * 100)

        for user in users:
            email = user['email'] or user['username']
            status = user['status']
            enabled = '✓' if user['enabled'] else '✗'
            created = user['created'][:19] if user['created'] else 'N/A'

            click.echo(f"{email:<40} {status:<20} {enabled:<10} {created:<25}")

        if not users:
            click.echo("  No users found.")

    except Exception as e:
        click.echo(f"Error listing users: {str(e)}", err=True)
        raise click.Abort()


@cli.command('create')
@click.argument('email')
@click.option('--no-invite', is_flag=True, help='Do not send invitation email (shows temp password instead)')
@click.pass_context
def create_user(ctx, email, no_invite):
    """Create a new admin user with the given email address."""
    manager = ctx.obj['manager']

    try:
        result = manager.create_user(email=email, send_invite=not no_invite)

        if result['success']:
            click.echo(f"\n✅ {result['message']}")
            click.echo(f"   Username: {result['username']}")
            if 'temporaryPassword' in result:
                click.echo(f"   Temporary Password: {result['temporaryPassword']}")
                click.echo("\n   User must change this password on first login.")
        else:
            click.echo(f"\n❌ Failed to create user: {result['error']}", err=True)
            raise click.Abort()

    except Exception as e:
        click.echo(f"Error creating user: {str(e)}", err=True)
        raise click.Abort()


@cli.command('delete')
@click.argument('username')
@click.option('--confirm', '-y', is_flag=True, help='Skip confirmation prompt')
@click.pass_context
def delete_user(ctx, username, confirm):
    """Delete a user from the Cognito User Pool."""
    manager = ctx.obj['manager']

    if not confirm:
        if not click.confirm(f"\n⚠️  Are you sure you want to delete user '{username}'?"):
            click.echo("Operation cancelled.")
            return

    try:
        result = manager.delete_user(username)

        if result['success']:
            click.echo(f"\n✅ {result['message']}")
        else:
            click.echo(f"\n❌ Failed to delete user: {result['error']}", err=True)
            raise click.Abort()

    except Exception as e:
        click.echo(f"Error deleting user: {str(e)}", err=True)
        raise click.Abort()


@cli.command('resend-invite')
@click.argument('username')
@click.pass_context
def resend_invite(ctx, username):
    """Resend invitation email to a user who hasn't confirmed yet."""
    manager = ctx.obj['manager']

    try:
        result = manager.resend_invite(username)

        if result['success']:
            click.echo(f"\n✅ {result['message']}")
        else:
            click.echo(f"\n❌ Failed to resend invite: {result['error']}", err=True)
            raise click.Abort()

    except Exception as e:
        click.echo(f"Error resending invite: {str(e)}", err=True)
        raise click.Abort()


@cli.command('enable')
@click.argument('username')
@click.pass_context
def enable_user(ctx, username):
    """Enable a disabled user."""
    manager = ctx.obj['manager']

    try:
        result = manager.enable_user(username)

        if result['success']:
            click.echo(f"\n✅ {result['message']}")
        else:
            click.echo(f"\n❌ Failed to enable user: {result['error']}", err=True)
            raise click.Abort()

    except Exception as e:
        click.echo(f"Error enabling user: {str(e)}", err=True)
        raise click.Abort()


@cli.command('disable')
@click.argument('username')
@click.option('--confirm', '-y', is_flag=True, help='Skip confirmation prompt')
@click.pass_context
def disable_user(ctx, username, confirm):
    """Disable a user (prevents login without deleting)."""
    manager = ctx.obj['manager']

    if not confirm:
        if not click.confirm(f"\n⚠️  Are you sure you want to disable user '{username}'?"):
            click.echo("Operation cancelled.")
            return

    try:
        result = manager.disable_user(username)

        if result['success']:
            click.echo(f"\n✅ {result['message']}")
        else:
            click.echo(f"\n❌ Failed to disable user: {result['error']}", err=True)
            raise click.Abort()

    except Exception as e:
        click.echo(f"Error disabling user: {str(e)}", err=True)
        raise click.Abort()


if __name__ == '__main__':
    cli()
