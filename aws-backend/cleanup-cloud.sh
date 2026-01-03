#!/bin/bash

# Cleanup script for Emosaic Cloud Infrastructure
# This script deletes all CloudFormation stacks in the correct order

set -e

ENVIRONMENT=${ENVIRONMENT:-prod}
REGION=${AWS_REGION:-eu-west-3}

# Stack names (in reverse deployment order)
STACK_PHASE3="${ENVIRONMENT}-phase3-enhancements"
STACK_MOSAIC_API="${ENVIRONMENT}-mosaic-api"
STACK_BATCH="${ENVIRONMENT}-batch-infrastructure"
STACK_JOB_HANDLER="${ENVIRONMENT}-job-handler"
STACK_MOSAIC_INFRA="${ENVIRONMENT}-mosaic-infrastructure"
STACK_TILE_FLAGS="${ENVIRONMENT}-tile-flags-infrastructure"

echo "🧹 Cleaning up Emosaic Cloud Infrastructure"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo ""

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install it first."
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Run 'aws configure'."
    exit 1
fi

echo "✅ AWS CLI configured"
echo ""

# Confirm deletion
echo "⚠️  WARNING: This will DELETE all deployed infrastructure!"
echo ""
echo "This includes:"
echo "  - All Lambda functions"
echo "  - DynamoDB tables (and all data)"
echo "  - S3 bucket (and all files)"
echo "  - Cognito User Pool (and all users)"
echo "  - API Gateway"
echo "  - EventBridge rules"
echo "  - IAM roles"
echo ""
read -p "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "❌ Cleanup cancelled"
    exit 0
fi

echo ""
echo "Starting cleanup in reverse deployment order..."
echo ""

# Function to delete stack and wait
delete_stack() {
    STACK_NAME=$1

    # Check if stack exists
    if aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION &> /dev/null; then
        echo "🗑️  Deleting stack: $STACK_NAME"
        aws cloudformation delete-stack --stack-name $STACK_NAME --region $REGION

        echo "   Waiting for deletion to complete..."
        aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME --region $REGION 2>&1 || {
            echo "   ⚠️  Warning: Stack deletion may have failed or timed out"
            echo "   Check AWS Console for details"
        }
        echo "   ✅ Stack deleted: $STACK_NAME"
    else
        echo "   ⏭️  Stack not found (already deleted?): $STACK_NAME"
    fi
    echo ""
}

# Delete stacks in reverse order
echo "====================================================================="
echo "Phase 1: Deleting Phase 3 Enhancements"
echo "====================================================================="
delete_stack $STACK_PHASE3

echo "====================================================================="
echo "Phase 2: Deleting Mosaic API"
echo "====================================================================="
delete_stack $STACK_MOSAIC_API

echo "====================================================================="
echo "Phase 3: Deleting Batch Infrastructure"
echo "====================================================================="
delete_stack $STACK_BATCH

echo "====================================================================="
echo "Phase 4: Deleting Job Handler"
echo "====================================================================="
delete_stack $STACK_JOB_HANDLER

echo "====================================================================="
echo "Phase 5: Deleting Mosaic Infrastructure"
echo "====================================================================="
echo ""
echo "⚠️  WARNING: This will delete the S3 bucket and DynamoDB tables!"
echo "   All tiles, mosaics, and job data will be permanently lost."
echo ""
read -p "Continue with deletion? (type 'yes' to confirm): " CONFIRM2

if [ "$CONFIRM2" != "yes" ]; then
    echo "❌ Stopped before deleting data stores"
    echo "   Remaining stacks: $STACK_MOSAIC_INFRA, $STACK_TILE_FLAGS"
    exit 0
fi

echo ""

# Empty S3 bucket before deletion (CloudFormation can't delete non-empty buckets)
BUCKET_NAME="${ENVIRONMENT}-emosaic-tiles"
if aws s3 ls s3://$BUCKET_NAME --region $REGION 2> /dev/null; then
    echo "🗑️  Emptying S3 bucket: $BUCKET_NAME"
    aws s3 rm s3://$BUCKET_NAME --recursive --region $REGION
    echo "   ✅ S3 bucket emptied"
else
    echo "   ⏭️  S3 bucket not found or already empty"
fi
echo ""

delete_stack $STACK_MOSAIC_INFRA

echo "====================================================================="
echo "Phase 6: Deleting Tile Flags Infrastructure"
echo "====================================================================="
delete_stack $STACK_TILE_FLAGS

echo ""
echo "====================================================================="
echo "🎉 Cleanup Complete!"
echo "====================================================================="
echo ""
echo "All CloudFormation stacks have been deleted."
echo ""
echo "To verify cleanup:"
echo "  aws cloudformation list-stacks --region $REGION --stack-status-filter DELETE_COMPLETE"
echo ""
echo "Remaining resources to check manually:"
echo "  - CloudWatch Log Groups (not auto-deleted)"
echo "  - ECR images (if Batch was deployed)"
echo ""
echo "To clean up logs:"
echo "  aws logs delete-log-group --log-group-name /aws/lambda/prod-* --region $REGION"
echo "  aws logs delete-log-group --log-group-name /aws/batch/prod-emosaic --region $REGION"
