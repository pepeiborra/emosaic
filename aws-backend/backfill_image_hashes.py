#!/usr/bin/env python3
"""
Backfill script to populate image hashes for existing images in S3.

This script scans the S3 bucket for existing images and computes their SHA-256 hashes,
storing them in the DynamoDB images table for duplicate detection.

Setup:
    pip install -r requirements.txt
    # or: pip install boto3

Usage:
    python3 backfill_image_hashes.py --bucket emosaic-tiles-prod --table prod-images
    python3 backfill_image_hashes.py --bucket emosaic-tiles-prod --table prod-images --table rc-images
    python3 backfill_image_hashes.py --bucket emosaic-tiles-prod --table prod-images --dry-run

Options:
    --bucket    S3 bucket name containing the images
    --table     DynamoDB table name(s) for storing hashes (can be specified multiple times)
    --prefix    S3 prefix to scan (default: tiles/)
    --region    AWS region (default: eu-west-3)
    --dry-run   Print what would be done without making changes
    --workers   Number of parallel workers (default: 10)
"""

import argparse
import hashlib
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Optional

import boto3
from botocore.exceptions import ClientError

# Clients initialized lazily in main()
s3_client = None
dynamodb = None


def compute_s3_object_hash(bucket: str, key: str) -> Optional[str]:
    """Download an S3 object and compute its SHA-256 hash."""
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        body = response['Body'].read()
        return hashlib.sha256(body).hexdigest()
    except ClientError as e:
        print(f"Error reading {key}: {e}")
        return None


def is_image_file(key: str) -> bool:
    """Check if a key represents an image file."""
    image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
    return any(key.lower().endswith(ext) for ext in image_extensions)


def list_s3_images(bucket: str, prefix: str):
    """List all image files in an S3 bucket with the given prefix."""
    paginator = s3_client.get_paginator('list_objects_v2')

    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get('Contents', []):
            key = obj['Key']
            if is_image_file(key):
                yield {
                    'key': key,
                    'size': obj['Size'],
                    'last_modified': obj['LastModified']
                }


def check_hash_exists(table, hash_value: str) -> bool:
    """Check if a hash already exists in the DynamoDB table."""
    try:
        response = table.get_item(Key={'image_hash': hash_value})
        return 'Item' in response
    except ClientError:
        return False


def store_hash(tables, hash_value: str, s3_key: str, filename: str):
    """Store an image hash in all DynamoDB tables."""
    results = {}
    for table in tables:
        table_name = table.table_name
        try:
            table.put_item(
                Item={
                    'image_hash': hash_value,
                    's3_key': s3_key,
                    'filename': filename,
                    'uploaded_at': datetime.utcnow().isoformat(),
                    'bucket': s3_key.split('/')[0] if '/' in s3_key else 'unknown',
                    'backfilled': True
                },
                ConditionExpression='attribute_not_exists(image_hash)'
            )
            results[table_name] = 'inserted'
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                results[table_name] = 'duplicate'
            else:
                raise
    return results


def process_image(bucket: str, tables: list, image_info: dict, dry_run: bool) -> dict:
    """Process a single image: compute hash and store in DynamoDB tables."""
    key = image_info['key']
    filename = key.split('/')[-1]

    result = {
        'key': key,
        'status': 'unknown',
        'hash': None,
        'table_results': {}
    }

    # Compute hash
    hash_value = compute_s3_object_hash(bucket, key)
    if not hash_value:
        result['status'] = 'error'
        result['error'] = 'Failed to compute hash'
        return result

    result['hash'] = hash_value

    if dry_run:
        # Check if it would be a duplicate (check first table only)
        if check_hash_exists(tables[0], hash_value):
            result['status'] = 'would_skip_duplicate'
        else:
            result['status'] = 'would_insert'
        return result

    # Store hash in all tables
    try:
        table_results = store_hash(tables, hash_value, key, filename)
        result['table_results'] = table_results

        # Determine overall status
        if all(r == 'inserted' for r in table_results.values()):
            result['status'] = 'inserted'
        elif all(r == 'duplicate' for r in table_results.values()):
            result['status'] = 'duplicate'
        else:
            result['status'] = 'partial'  # Some inserted, some duplicate
    except Exception as e:
        result['status'] = 'error'
        result['error'] = str(e)

    return result


def main():
    parser = argparse.ArgumentParser(
        description='Backfill image hashes for duplicate detection'
    )
    parser.add_argument('--bucket', required=True, help='S3 bucket name')
    parser.add_argument('--table', required=True, action='append', dest='tables',
                        help='DynamoDB table name (can be specified multiple times)')
    parser.add_argument('--prefix', default='tiles/', help='S3 prefix to scan')
    parser.add_argument('--region', default='eu-west-3', help='AWS region (default: eu-west-3)')
    parser.add_argument('--dry-run', action='store_true', help='Print without making changes')
    parser.add_argument('--workers', type=int, default=10, help='Number of parallel workers')

    args = parser.parse_args()

    # Initialize AWS clients
    global s3_client, dynamodb
    s3_client = boto3.client('s3', region_name=args.region)
    dynamodb = boto3.resource('dynamodb', region_name=args.region)

    # Get table references
    tables = [dynamodb.Table(table_name) for table_name in args.tables]

    print(f"Scanning s3://{args.bucket}/{args.prefix}")
    print(f"Target tables: {', '.join(args.tables)}")
    if args.dry_run:
        print("DRY RUN - no changes will be made")
    print()

    # Collect all images first
    print("Listing images...")
    images = list(list_s3_images(args.bucket, args.prefix))
    print(f"Found {len(images)} images")
    print()

    if not images:
        print("No images found.")
        return

    # Process images in parallel
    stats = {
        'inserted': 0,
        'duplicate': 0,
        'partial': 0,
        'error': 0,
        'would_insert': 0,
        'would_skip_duplicate': 0
    }

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(process_image, args.bucket, tables, img, args.dry_run): img
            for img in images
        }

        processed = 0
        for future in as_completed(futures):
            processed += 1
            result = future.result()
            status = result['status']
            stats[status] = stats.get(status, 0) + 1

            # Progress update every 100 images
            if processed % 100 == 0:
                print(f"Processed {processed}/{len(images)} images...")

            # Print errors
            if status == 'error':
                print(f"  ERROR: {result['key']}: {result.get('error', 'Unknown error')}")

    print()
    print("=" * 50)
    print("SUMMARY")
    print("=" * 50)
    print(f"Total images scanned: {len(images)}")

    if args.dry_run:
        print(f"Would insert: {stats.get('would_insert', 0)}")
        print(f"Would skip (duplicate): {stats.get('would_skip_duplicate', 0)}")
    else:
        print(f"Inserted (all tables): {stats.get('inserted', 0)}")
        print(f"Partial (some tables): {stats.get('partial', 0)}")
        print(f"Duplicates (all tables): {stats.get('duplicate', 0)}")

    print(f"Errors: {stats.get('error', 0)}")


if __name__ == '__main__':
    main()
