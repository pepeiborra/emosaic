#!/bin/bash

# Cleanup and Redeploy Script for Tile Flagging System
set -e

ENVIRONMENT=${ENVIRONMENT:-prod}
REGION=${AWS_REGION:-us-east-1}
STACK_NAME="${ENVIRONMENT}-tile-flags-infrastructure"

echo "🧹 Cleaning up failed deployment and redeploying..."
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo "Stack: $STACK_NAME"
echo ""

# Step 1: Check if stack exists and get its status
echo "📋 Checking stack status..."
STACK_STATUS=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || echo "DOES_NOT_EXIST")

echo "Current stack status: $STACK_STATUS"
echo ""

# Step 2: Delete the stack if it's in ROLLBACK_COMPLETE or other failed states
if [[ "$STACK_STATUS" == "ROLLBACK_COMPLETE" ]] || \
   [[ "$STACK_STATUS" == "CREATE_FAILED" ]] || \
   [[ "$STACK_STATUS" == "UPDATE_ROLLBACK_COMPLETE" ]] || \
   [[ "$STACK_STATUS" == "UPDATE_ROLLBACK_FAILED" ]] || \
   [[ "$STACK_STATUS" == "DELETE_FAILED" ]]; then

    echo "⚠️  Stack is in a failed state ($STACK_STATUS)"
    echo "🗑️  Deleting stack..."

    aws cloudformation delete-stack \
        --stack-name $STACK_NAME \
        --region $REGION

    echo "⏳ Waiting for stack deletion to complete..."
    aws cloudformation wait stack-delete-complete \
        --stack-name $STACK_NAME \
        --region $REGION

    echo "✅ Stack deleted successfully"
    echo ""

elif [[ "$STACK_STATUS" == "DOES_NOT_EXIST" ]]; then
    echo "ℹ️  Stack does not exist, proceeding with deployment"
    echo ""
else
    echo "✅ Stack exists and is in a good state: $STACK_STATUS"
    echo ""
fi

# Step 3: Run the deployment script
echo "🚀 Running deployment script..."
./deploy.sh
