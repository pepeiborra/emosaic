#!/usr/bin/env python3
"""
Tile Flag Management CLI

A command-line interface for managing flagged tiles in the mosaic system.
Provides commands to list and delete flagged tile entries from DynamoDB.
"""

import json
import boto3
import click
import os
from datetime import datetime
from decimal import Decimal
from typing import List, Optional, Dict, Any
import base64


class TileManager:
    """Manages interactions with the tile flags DynamoDB table."""

    def __init__(self, environment: str = 'prod', region: str = 'us-east-1'):
        self.environment = environment
        self.region = region
        self.table_name = f"{environment}-tile-flags"

        # Initialize DynamoDB client
        self.dynamodb = boto3.resource('dynamodb', region_name=region)
        self.table = self.dynamodb.Table(self.table_name)

    def _serialize_decimal(self, obj):
        """JSON serializer for DynamoDB Decimal types."""
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        raise TypeError(f"Object {obj} is not JSON serializable")

    def list_flags(self, limit: int = 100, last_key: Optional[str] = None) -> Dict[str, Any]:
        """
        List all flagged tiles with pagination support.

        Args:
            limit: Maximum number of items to return (max 1000)
            last_key: Base64 encoded pagination token for next page

        Returns:
            Dict containing flags, pagination info, and summary statistics
        """
        from boto3.dynamodb.conditions import Attr

        # Build scan parameters
        scan_params = {
            'Limit': min(limit, 1000),
            'FilterExpression': Attr('flag_status').eq('flagged')
        }

        # Add pagination if provided
        if last_key:
            try:
                decoded_key = json.loads(base64.b64decode(last_key).decode('utf-8'))
                scan_params['ExclusiveStartKey'] = decoded_key
            except Exception as e:
                click.echo(f"Warning: Invalid pagination token: {e}")

        # Scan the table
        response = self.table.scan(**scan_params)

        # Format results
        flags = []
        for item in response.get('Items', []):
            flags.append({
                'tileHash': item.get('tile_hash'),
                'tilePath': item.get('tile_path'),
                'flaggedAt': item.get('flagged_at'),
                'flagStatus': item.get('flag_status', 'flagged'),
                'ttl': item.get('ttl')
            })

        # Sort by flagged_at descending (most recent first)
        flags.sort(key=lambda x: x.get('flaggedAt', ''), reverse=True)

        # Prepare result
        result = {
            'flags': flags,
            'count': len(flags),
            'scannedCount': response.get('ScannedCount', 0),
            'hasMore': 'LastEvaluatedKey' in response
        }

        # Add pagination token if there are more results
        if 'LastEvaluatedKey' in response:
            next_key = base64.b64encode(
                json.dumps(response['LastEvaluatedKey']).encode('utf-8')
            ).decode('utf-8')
            result['nextKey'] = next_key

        # Add summary statistics
        now = datetime.utcnow()
        today_count = 0
        week_count = 0

        for flag in flags:
            try:
                flag_date = datetime.fromisoformat(flag['flaggedAt'].replace('Z', '+00:00'))
                days_ago = (now - flag_date).days

                if days_ago == 0:
                    today_count += 1
                if days_ago <= 7:
                    week_count += 1
            except:
                continue

        result['summary'] = {
            'total': len(flags),
            'today': today_count,
            'thisWeek': week_count,
            'retrievedAt': now.isoformat() + 'Z'
        }

        return result

    def delete_flags(self, tile_hashes: List[str]) -> Dict[str, Any]:
        """
        Delete one or more flagged tiles by their hash.

        Args:
            tile_hashes: List of tile hashes to delete

        Returns:
            Dict with success/failure counts and details
        """
        results = {
            'requested': len(tile_hashes),
            'deleted': 0,
            'failed': 0,
            'details': []
        }

        for tile_hash in tile_hashes:
            try:
                # Check if item exists first
                response = self.table.get_item(Key={'tile_hash': tile_hash})

                if 'Item' not in response:
                    results['failed'] += 1
                    results['details'].append({
                        'tileHash': tile_hash,
                        'status': 'not_found',
                        'message': 'Tile not found in database'
                    })
                    continue

                # Delete the item
                self.table.delete_item(Key={'tile_hash': tile_hash})

                results['deleted'] += 1
                results['details'].append({
                    'tileHash': tile_hash,
                    'status': 'deleted',
                    'message': 'Successfully deleted'
                })

            except Exception as e:
                results['failed'] += 1
                results['details'].append({
                    'tileHash': tile_hash,
                    'status': 'error',
                    'message': str(e)
                })

        return results


# CLI Commands
@click.group()
@click.option('--environment', '-e', default='prod', help='Environment (prod, staging, etc.)')
@click.option('--region', '-r', default='us-east-1', help='AWS region')
@click.pass_context
def cli(ctx, environment, region):
    """Tile Flag Management CLI - Manage flagged tiles in the mosaic system."""
    ctx.ensure_object(dict)
    ctx.obj['manager'] = TileManager(environment=environment, region=region)


@cli.command()
@click.option('--limit', '-l', default=100, help='Number of items to return (max 1000)')
@click.option('--next-key', '-n', help='Pagination token for next page')
@click.option('--format', '-f', type=click.Choice(['table', 'json']), default='table', help='Output format')
@click.pass_context
def list(ctx, limit, next_key, format):
    """List all flagged tiles with pagination support."""
    manager = ctx.obj['manager']

    try:
        result = manager.list_flags(limit=limit, last_key=next_key)

        if format == 'json':
            click.echo(json.dumps(result, indent=2, default=manager._serialize_decimal))
            return

        # Table format
        flags = result['flags']
        summary = result['summary']

        if not flags:
            click.echo("No flagged tiles found.")
            return

        # Print summary
        click.echo(f"\n📊 Summary:")
        click.echo(f"  Total flags: {summary['total']}")
        click.echo(f"  Today: {summary['today']}")
        click.echo(f"  This week: {summary['thisWeek']}")
        click.echo(f"  Retrieved at: {summary['retrievedAt']}")

        # Print table header
        click.echo(f"\n🏷️  Flagged Tiles (showing {len(flags)} of {result['scannedCount']} scanned):")
        click.echo("─" * 120)
        click.echo(f"{'Tile Hash':<20} {'Flagged At':<25} {'Tile Path':<60} {'Status':<10}")
        click.echo("─" * 120)

        # Print flags
        for flag in flags:
            tile_hash = flag['tileHash'][:18] + '..' if len(flag['tileHash']) > 20 else flag['tileHash']
            flagged_at = flag['flaggedAt'][:19] if flag['flaggedAt'] else 'N/A'

            # Smart path truncation - show end of path (filename + parent dirs) instead of beginning
            full_path = flag.get('tilePath', 'N/A')
            if len(full_path) > 60:
                tile_path = '..' + full_path[-(60-2):]  # Show last 58 chars with ".." prefix
            else:
                tile_path = full_path

            status = flag['flagStatus']

            click.echo(f"{tile_hash:<20} {flagged_at:<25} {tile_path:<60} {status:<10}")

        # Print pagination info
        if result['hasMore']:
            click.echo(f"\n📄 More results available. Use --next-key '{result['nextKey']}' to continue.")

    except Exception as e:
        click.echo(f"❌ Error listing flags: {str(e)}", err=True)
        raise click.Abort()


@cli.command()
@click.option('--batch-size', '-b', default=50, help='Number of tiles to fetch per batch')
@click.pass_context
def review(ctx, batch_size):
    """Interactively review flagged tiles with options to open, delete, or continue."""
    import subprocess
    import platform

    manager = ctx.obj['manager']

    try:
        reviewed_count = 0
        unflagged_count = 0
        deleted_count = 0
        last_key = None

        click.echo("🔍 Interactive Tile Review")
        click.echo("Options: (o)pen, (u)nflag, (d)elete file, (c)ontinue, (q)uit")
        click.echo("─" * 60)

        while True:
            # Fetch next batch of flags
            result = manager.list_flags(limit=batch_size, last_key=last_key)
            flags = result['flags']

            if not flags:
                click.echo("✅ No more flagged tiles to review!")
                break

            for flag in flags:
                reviewed_count += 1

                # Display tile information
                click.echo(f"\n📷 Tile {reviewed_count}")
                click.echo(f"   Hash: {flag['tileHash']}")
                click.echo(f"   Path: {flag.get('tilePath', 'N/A')}")
                click.echo(f"   Flagged: {flag.get('flaggedAt', 'N/A')}")

                while True:
                    choice = click.prompt(
                        "\nAction",
                        type=click.Choice(['o', 'open', 'u', 'unflag', 'd', 'delete', 'c', 'continue', 'q', 'quit'], case_sensitive=False),
                        default='c'
                    ).lower()

                    if choice in ['o', 'open']:
                        # Try to open the file with default system application
                        file_path = flag.get('tilePath')
                        if file_path and file_path != 'N/A':
                            try:
                                system = platform.system()
                                if system == "Darwin":  # macOS
                                    subprocess.run(["open", file_path], check=True)
                                elif system == "Windows":
                                    subprocess.run(["start", file_path], shell=True, check=True)
                                else:  # Linux and others
                                    subprocess.run(["xdg-open", file_path], check=True)
                                click.echo(f"✅ Opened: {file_path}")
                            except Exception as e:
                                click.echo(f"❌ Failed to open file: {e}")
                        else:
                            click.echo("❌ No valid file path available")
                        # Continue the inner loop to ask for next action
                        continue

                    elif choice in ['u', 'unflag']:
                        # Unflag this tile (remove from flagged list)
                        tile_hash = flag['tileHash']
                        delete_result = manager.delete_flags([tile_hash])
                        if delete_result['deleted'] > 0:
                            unflagged_count += 1
                            click.echo(f"✅ Unflagged tile: {tile_hash}")
                        else:
                            click.echo(f"❌ Failed to unflag tile: {tile_hash}")
                        break  # Move to next tile

                    elif choice in ['d', 'delete']:
                        # Delete the actual file from filesystem
                        file_path = flag.get('tilePath')
                        if file_path and file_path != 'N/A':
                            try:
                                import os
                                if os.path.exists(file_path):
                                    if click.confirm(f"⚠️  Really delete file from disk: {file_path}?"):
                                        os.remove(file_path)
                                        click.echo(f"🗑️ Deleted file: {file_path}")

                                        # Also unflag the tile since file is gone
                                        tile_hash = flag['tileHash']
                                        delete_result = manager.delete_flags([tile_hash])
                                        if delete_result['deleted'] > 0:
                                            click.echo(f"✅ Also unflagged tile: {tile_hash}")
                                        deleted_count += 1
                                    else:
                                        click.echo("❌ File deletion cancelled")
                                        continue  # Ask for action again
                                else:
                                    click.echo(f"❌ File not found: {file_path}")
                            except Exception as e:
                                click.echo(f"❌ Failed to delete file: {e}")
                        else:
                            click.echo("❌ No valid file path available")
                        break  # Move to next tile

                    elif choice in ['c', 'continue']:
                        break  # Move to next tile

                    elif choice in ['q', 'quit']:
                        click.echo(f"\n📊 Review Summary:")
                        click.echo(f"   Reviewed: {reviewed_count}")
                        click.echo(f"   Unflagged: {unflagged_count}")
                        click.echo(f"   Deleted files: {deleted_count}")
                        click.echo("👋 Review session ended.")
                        return

            # Check if there are more tiles
            if not result['hasMore']:
                break

            last_key = result.get('nextKey')

        # Final summary
        click.echo(f"\n📊 Review Complete:")
        click.echo(f"   Total reviewed: {reviewed_count}")
        click.echo(f"   Total unflagged: {unflagged_count}")
        click.echo(f"   Total deleted files: {deleted_count}")

    except KeyboardInterrupt:
        click.echo(f"\n\n⚠️ Review interrupted by user")
        click.echo(f"📊 Summary:")
        click.echo(f"   Reviewed: {reviewed_count}")
        click.echo(f"   Unflagged: {unflagged_count}")
        click.echo(f"   Deleted files: {deleted_count}")
    except Exception as e:
        click.echo(f"❌ Error during review: {str(e)}", err=True)
        raise click.Abort()


@cli.command()
@click.argument('tile_hashes', nargs=-1, required=True)
@click.option('--confirm', '-y', is_flag=True, help='Skip confirmation prompt')
@click.pass_context
def delete(ctx, tile_hashes, confirm):
    """Delete one or more flagged tiles by their hash."""
    manager = ctx.obj['manager']

    if not confirm:
        tile_list = '\n  '.join(tile_hashes)
        click.echo(f"\n🗑️  About to delete {len(tile_hashes)} tile(s):")
        click.echo(f"  {tile_list}")

        if not click.confirm("\nAre you sure you want to proceed?"):
            click.echo("Operation cancelled.")
            return

    try:
        result = manager.delete_flags(tile_hashes)

        # Print summary
        click.echo(f"\n📊 Deletion Summary:")
        click.echo(f"  Requested: {result['requested']}")
        click.echo(f"  Deleted: {result['deleted']}")
        click.echo(f"  Failed: {result['failed']}")

        # Print details
        if result['details']:
            click.echo(f"\n📝 Details:")
            for detail in result['details']:
                status_icon = "✅" if detail['status'] == 'deleted' else "❌"
                click.echo(f"  {status_icon} {detail['tileHash']}: {detail['message']}")

        if result['failed'] > 0:
            raise click.Abort()

    except Exception as e:
        click.echo(f"❌ Error deleting flags: {str(e)}", err=True)
        raise click.Abort()


if __name__ == '__main__':
    cli()