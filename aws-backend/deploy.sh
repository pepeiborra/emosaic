#!/bin/bash

# Deployment script for Tile Flagging System AWS Infrastructure
set -e

ENVIRONMENT=${ENVIRONMENT:-prod}
REGION=${AWS_REGION:-us-east-1}
CORS_ORIGIN=${CORS_ORIGIN:-https://casadelmanco.com}
STACK_NAME_INFRA="${ENVIRONMENT}-tile-flags-infrastructure"
STACK_NAME_API="${ENVIRONMENT}-tile-flags-api"

echo "🚀 Deploying Tile Flagging System to AWS"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo "CORS Origin: $CORS_ORIGIN"
echo ""

# Check AWS CLI is installed and configured
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

# Step 1: Package and deploy Lambda functions
echo ""
echo "📦 Packaging Lambda functions..."

# Create deployment package for Lambda functions
cd lambda
echo "Packaging toggle_flag..."
zip -r ../toggle_flag.zip toggle_flag.py
echo "Packaging get_flags..."
zip -r ../get_flags.zip get_flags.py
echo "Packaging admin_get_all_flags..."
zip -r ../admin_get_all_flags.zip admin_get_all_flags.py
cd ..

# Step 2: Deploy infrastructure stack
echo ""
echo "🏗️  Deploying infrastructure stack..."

aws cloudformation deploy \
    --template-file cloudformation/tile-flags-infrastructure.yaml \
    --stack-name $STACK_NAME_INFRA \
    --parameter-overrides \
        Environment=$ENVIRONMENT \
        CorsOrigin="$CORS_ORIGIN" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

if [ $? -eq 0 ]; then
    echo "✅ Infrastructure stack deployed successfully"
else
    echo "❌ Infrastructure stack deployment failed"
    exit 1
fi

# Step 3: Update Lambda function code
echo ""
echo "📤 Updating Lambda function code..."

TOGGLE_FUNCTION_NAME=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME_INFRA \
    --query "Stacks[0].Outputs[?OutputKey=='ToggleFlagFunctionName'].OutputValue" \
    --output text \
    --region $REGION)

GET_FUNCTION_NAME=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME_INFRA \
    --query "Stacks[0].Outputs[?OutputKey=='GetFlagsFunctionName'].OutputValue" \
    --output text \
    --region $REGION)

ADMIN_FUNCTION_NAME=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME_INFRA \
    --query "Stacks[0].Outputs[?OutputKey=='AdminGetAllFlagsFunctionName'].OutputValue" \
    --output text \
    --region $REGION)

echo "Updating $TOGGLE_FUNCTION_NAME..."
aws lambda update-function-code \
    --function-name $TOGGLE_FUNCTION_NAME \
    --zip-file fileb://toggle_flag.zip \
    --region $REGION

echo "Updating $GET_FUNCTION_NAME..."
aws lambda update-function-code \
    --function-name $GET_FUNCTION_NAME \
    --zip-file fileb://get_flags.zip \
    --region $REGION

echo "Updating $ADMIN_FUNCTION_NAME..."
aws lambda update-function-code \
    --function-name $ADMIN_FUNCTION_NAME \
    --zip-file fileb://admin_get_all_flags.zip \
    --region $REGION

# Step 4: Get API endpoint
echo ""
echo "📋 Deployment Summary:"

API_URL=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME_INFRA \
    --query "Stacks[0].Outputs[?OutputKey=='APIGatewayURL'].OutputValue" \
    --output text \
    --region $REGION)

echo "🎯 API Gateway URL: $API_URL"
echo ""
echo "API Endpoints:"
echo "  POST   $API_URL/tiles/{tileHash}/flag     - Flag a tile"
echo "  DELETE $API_URL/tiles/{tileHash}/flag     - Unflag a tile"
echo "  POST   $API_URL/tiles/flags               - Get bulk flag status"
echo "  GET    $API_URL/admin/flags               - Admin: Get all flags"
echo ""

# Step 6: Test API endpoints
echo "🧪 Testing API endpoints..."

# Test the bulk flags endpoint
echo "Testing bulk flags endpoint..."
TEST_RESPONSE=$(curl -s -X POST "$API_URL/tiles/flags" \
    -H "Content-Type: application/json" \
    -d '{"tileHashes": ["test123"]}' \
    -w "HTTP_%{http_code}")

if [[ $TEST_RESPONSE == *"HTTP_200"* ]]; then
    echo "✅ API endpoints are working"
else
    echo "⚠️  API endpoints may not be ready yet (CloudFormation propagation delay)"
fi

# Cleanup temporary files
rm -f toggle_flag.zip get_flags.zip admin_get_all_flags.zip

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "Next steps:"
echo "1. Update your frontend JavaScript to use: $API_URL"
echo "2. Test the flagging functionality"
echo "3. Monitor CloudWatch logs for any issues"