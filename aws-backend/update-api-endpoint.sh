#!/bin/bash

# Script to update the API endpoint in the frontend JavaScript after deployment

set -e

ENVIRONMENT=${ENVIRONMENT:-prod}
REGION=${AWS_REGION:-us-east-1}
STACK_NAME_API="${ENVIRONMENT}-tile-flags-infrastructure"
JS_FILE="../src/assets/mosaic-widget.js"

echo "🔧 Updating API endpoint in frontend..."

# Get the API URL from CloudFormation
API_URL=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME_API \
    --query "Stacks[0].Outputs[?OutputKey=='APIGatewayURL'].OutputValue" \
    --output text \
    --region $REGION)

if [ -z "$API_URL" ]; then
    echo "❌ Could not retrieve API URL from CloudFormation stack: $STACK_NAME_API"
    exit 1
fi

echo "📍 Found API URL: $API_URL"

# Update the JavaScript file
if [ -f "$JS_FILE" ]; then
    # Create backup
    cp "$JS_FILE" "${JS_FILE}.backup"
    
    # Update the API base URL
    sed -i.tmp "s|this\.apiBase = 'https://YOUR_API_ID\.execute-api\.us-east-1\.amazonaws\.com/prod';|this.apiBase = '$API_URL';|g" "$JS_FILE"
    
    # Clean up temp file
    rm -f "${JS_FILE}.tmp"
    
    echo "✅ Updated API endpoint in $JS_FILE"
    echo "📄 Backup created at ${JS_FILE}.backup"
else
    echo "❌ JavaScript file not found: $JS_FILE"
    exit 1
fi

echo ""
echo "🎯 Frontend configuration updated!"
echo "Next steps:"
echo "1. Regenerate your mosaic with 'make upload' to deploy the updated JavaScript"
echo "2. Test the flagging functionality"
echo "3. Check CloudWatch logs if issues occur"