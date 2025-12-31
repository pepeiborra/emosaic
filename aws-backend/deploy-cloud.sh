#!/bin/bash

# Deployment script for Emosaic Cloud Infrastructure
# This script deploys:
# 1. Tile flags infrastructure (existing)
# 2. Mosaic management infrastructure (new)
# 3. Mosaic API (new)

set -e

ENVIRONMENT=${ENVIRONMENT:-prod}
REGION=${AWS_REGION:-eu-west-3}
CORS_ORIGIN=${CORS_ORIGIN:-https://casadelmanco.com}
ADMIN_EMAIL=${ADMIN_EMAIL:-}

# Stack names
STACK_TILE_FLAGS="${ENVIRONMENT}-tile-flags-infrastructure"
STACK_MOSAIC_INFRA="${ENVIRONMENT}-mosaic-infrastructure"
STACK_MOSAIC_API="${ENVIRONMENT}-mosaic-api"

echo "🚀 Deploying Emosaic Cloud Infrastructure"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo "CORS Origin: $CORS_ORIGIN"
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

# Validate admin email is provided
if [ -z "$ADMIN_EMAIL" ]; then
    echo "⚠️  Warning: ADMIN_EMAIL not set. You'll need to provide it for initial Cognito setup."
    echo "   Usage: ADMIN_EMAIL=admin@example.com ./deploy-cloud.sh"
    read -p "Enter admin email address: " ADMIN_EMAIL
    if [ -z "$ADMIN_EMAIL" ]; then
        echo "❌ Admin email is required for deployment"
        exit 1
    fi
fi

echo ""
echo "====================================================================="
echo "Phase 1: Deploying Tile Flags Infrastructure (Existing)"
echo "====================================================================="
echo ""

# Package Lambda functions for tile flags
echo "📦 Packaging tile flags Lambda functions..."
cd lambda
zip -q -r ../toggle_flag.zip toggle_flag.py
zip -q -r ../get_flags.zip get_flags.py
zip -q -r ../admin_get_all_flags.zip admin_get_all_flags.py
cd ..

# Deploy tile flags infrastructure
echo "🏗️  Deploying tile flags stack..."
aws cloudformation deploy \
    --template-file cloudformation/tile-flags-infrastructure.yaml \
    --stack-name $STACK_TILE_FLAGS \
    --parameter-overrides \
        Environment=$ENVIRONMENT \
        CorsOrigin="$CORS_ORIGIN" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

if [ $? -eq 0 ]; then
    echo "✅ Tile flags infrastructure deployed"
else
    echo "❌ Tile flags infrastructure deployment failed"
    exit 1
fi

# Update tile flags Lambda code
echo "📤 Updating tile flags Lambda code..."
TOGGLE_FN=$(aws cloudformation describe-stacks --stack-name $STACK_TILE_FLAGS --query "Stacks[0].Outputs[?OutputKey=='ToggleFlagFunctionName'].OutputValue" --output text --region $REGION)
GET_FN=$(aws cloudformation describe-stacks --stack-name $STACK_TILE_FLAGS --query "Stacks[0].Outputs[?OutputKey=='GetFlagsFunctionName'].OutputValue" --output text --region $REGION)
ADMIN_FN=$(aws cloudformation describe-stacks --stack-name $STACK_TILE_FLAGS --query "Stacks[0].Outputs[?OutputKey=='AdminGetAllFlagsFunctionName'].OutputValue" --output text --region $REGION)

aws lambda update-function-code --function-name $TOGGLE_FN --zip-file fileb://toggle_flag.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $GET_FN --zip-file fileb://get_flags.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $ADMIN_FN --zip-file fileb://admin_get_all_flags.zip --region $REGION > /dev/null

rm -f toggle_flag.zip get_flags.zip admin_get_all_flags.zip

echo ""
echo "====================================================================="
echo "Phase 2: Deploying Mosaic Infrastructure (S3, DynamoDB, Cognito)"
echo "====================================================================="
echo ""

# Deploy mosaic infrastructure
echo "🏗️  Deploying mosaic infrastructure stack..."
aws cloudformation deploy \
    --template-file cloudformation/mosaic-infrastructure.yaml \
    --stack-name $STACK_MOSAIC_INFRA \
    --parameter-overrides \
        Environment=$ENVIRONMENT \
        AdminEmail="$ADMIN_EMAIL" \
        CorsOrigin="$CORS_ORIGIN" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

if [ $? -eq 0 ]; then
    echo "✅ Mosaic infrastructure deployed"
else
    echo "❌ Mosaic infrastructure deployment failed"
    exit 1
fi

echo ""
echo "====================================================================="
echo "Phase 3: Deploying Mosaic API (Lambda + API Gateway)"
echo "====================================================================="
echo ""

# Package mosaic Lambda functions
echo "📦 Packaging mosaic Lambda functions..."
cd lambda/mosaic

zip -q -r ../../list_mosaics.zip list_mosaics.py
zip -q -r ../../get_mosaic.zip get_mosaic.py
zip -q -r ../../create_mosaic.zip create_mosaic.py
zip -q -r ../../update_mosaic.zip update_mosaic.py
zip -q -r ../../delete_mosaic.zip delete_mosaic.py
zip -q -r ../../submit_job.zip submit_job.py
zip -q -r ../../get_job.zip get_job.py

cd ../..

# Deploy mosaic API
echo "🏗️  Deploying mosaic API stack..."
aws cloudformation deploy \
    --template-file cloudformation/mosaic-api.yaml \
    --stack-name $STACK_MOSAIC_API \
    --parameter-overrides \
        Environment=$ENVIRONMENT \
        CorsOrigin="$CORS_ORIGIN" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

if [ $? -eq 0 ]; then
    echo "✅ Mosaic API deployed"
else
    echo "❌ Mosaic API deployment failed"
    exit 1
fi

# Update mosaic Lambda code
echo "📤 Updating mosaic Lambda code..."
LIST_FN=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_API --query "Stacks[0].Outputs[?OutputKey=='ListMosaicsFunctionName'].OutputValue" --output text --region $REGION)
GET_FN=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_API --query "Stacks[0].Outputs[?OutputKey=='GetMosaicFunctionName'].OutputValue" --output text --region $REGION)
CREATE_FN=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_API --query "Stacks[0].Outputs[?OutputKey=='CreateMosaicFunctionName'].OutputValue" --output text --region $REGION)
UPDATE_FN=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_API --query "Stacks[0].Outputs[?OutputKey=='UpdateMosaicFunctionName'].OutputValue" --output text --region $REGION)
DELETE_FN=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_API --query "Stacks[0].Outputs[?OutputKey=='DeleteMosaicFunctionName'].OutputValue" --output text --region $REGION)
SUBMIT_FN=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_API --query "Stacks[0].Outputs[?OutputKey=='SubmitJobFunctionName'].OutputValue" --output text --region $REGION)
GETJOB_FN=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_API --query "Stacks[0].Outputs[?OutputKey=='GetJobFunctionName'].OutputValue" --output text --region $REGION)

aws lambda update-function-code --function-name $LIST_FN --zip-file fileb://list_mosaics.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $GET_FN --zip-file fileb://get_mosaic.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $CREATE_FN --zip-file fileb://create_mosaic.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $UPDATE_FN --zip-file fileb://update_mosaic.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $DELETE_FN --zip-file fileb://delete_mosaic.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $SUBMIT_FN --zip-file fileb://submit_job.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $GETJOB_FN --zip-file fileb://get_job.zip --region $REGION > /dev/null

rm -f list_mosaics.zip get_mosaic.zip create_mosaic.zip update_mosaic.zip delete_mosaic.zip submit_job.zip get_job.zip

echo ""
echo "====================================================================="
echo "📋 Deployment Summary"
echo "====================================================================="
echo ""

# Get outputs
API_URL=$(aws cloudformation describe-stacks --stack-name $STACK_TILE_FLAGS --query "Stacks[0].Outputs[?OutputKey=='APIGatewayURL'].OutputValue" --output text --region $REGION)
TILES_BUCKET=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_INFRA --query "Stacks[0].Outputs[?OutputKey=='TilesBucketName'].OutputValue" --output text --region $REGION)
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_INFRA --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text --region $REGION)
USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_INFRA --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text --region $REGION)

echo "🎯 API Gateway URL: $API_URL"
echo "🪣 S3 Tiles Bucket: $TILES_BUCKET"
echo "👤 Cognito User Pool ID: $USER_POOL_ID"
echo "🔑 Cognito Client ID: $USER_POOL_CLIENT_ID"
echo ""
echo "API Endpoints:"
echo "  Tile Flags:"
echo "    POST   $API_URL/tiles/{tileHash}/flag     - Flag a tile"
echo "    DELETE $API_URL/tiles/{tileHash}/flag     - Unflag a tile"
echo "    POST   $API_URL/tiles/flags               - Get bulk flag status"
echo "    GET    $API_URL/admin/flags               - Admin: Get all flags"
echo ""
echo "  Mosaic Management (require Cognito auth):"
echo "    GET    $API_URL/mosaics                   - List all mosaics"
echo "    POST   $API_URL/mosaics                   - Create new mosaic"
echo "    GET    $API_URL/mosaics/{id}              - Get mosaic details"
echo "    PUT    $API_URL/mosaics/{id}              - Update mosaic"
echo "    DELETE $API_URL/mosaics/{id}              - Delete mosaic"
echo ""
echo "  Job Management (require Cognito auth):"
echo "    POST   $API_URL/jobs                      - Submit generation job"
echo "    GET    $API_URL/jobs/{id}                 - Get job status"
echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "Next steps:"
echo "1. Check your email ($ADMIN_EMAIL) for Cognito temporary password"
echo "2. Update frontend to use these API endpoints"
echo "3. Configure CloudFront for the S3 bucket"
echo "4. Test the API endpoints with authentication"
