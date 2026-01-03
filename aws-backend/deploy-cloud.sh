#!/bin/bash

# Deployment script for Emosaic Cloud Infrastructure
# This script deploys:
# 1. Tile flags infrastructure (existing)
# 2. Mosaic management infrastructure (S3, DynamoDB, Cognito)
# 3. Job handler (EventBridge + Lambda)
# 4. Batch infrastructure (ECR, Batch, compute)
# 5. Mosaic API (API Gateway + Lambda)
#
# Options:
#   CLEAN_FIRST=true  - Delete all stacks before deploying (use for major updates)

set -e

ENVIRONMENT=${ENVIRONMENT:-prod}
REGION=${AWS_REGION:-eu-west-3}
CORS_ORIGIN=${CORS_ORIGIN:-https://casadelmanco.com}
ADMIN_EMAIL=${ADMIN_EMAIL:-}
VPC_ID=${VPC_ID:-}
SUBNET_IDS=${SUBNET_IDS:-}
USE_EXISTING_RESOURCES=${USE_EXISTING_RESOURCES:-true}
EXISTING_TILES_BUCKET=${EXISTING_TILES_BUCKET:-emosaic-tiles-prod}
CLEAN_FIRST=${CLEAN_FIRST:-false}

# Custom domain configuration (optional)
CUSTOM_DOMAIN=${CUSTOM_DOMAIN:-}
ROOT_DOMAIN=${ROOT_DOMAIN:-casadelmanco.com}
HOSTED_ZONE_ID=${HOSTED_ZONE_ID:-}

# Stack names (in deployment order)
STACK_TILE_FLAGS="${ENVIRONMENT}-tile-flags-infrastructure"
STACK_MOSAIC_INFRA="${ENVIRONMENT}-mosaic-infrastructure"
STACK_JOB_HANDLER="${ENVIRONMENT}-job-handler"
STACK_BATCH="${ENVIRONMENT}-batch-infrastructure"
STACK_MOSAIC_API="${ENVIRONMENT}-mosaic-api"
STACK_PHASE3="${ENVIRONMENT}-phase3-enhancements"
STACK_CERTIFICATE="${ENVIRONMENT}-domain-certificate"
STACK_ADMIN_UI="${ENVIRONMENT}-admin-ui"

# Stacks in reverse dependency order (for deletion)
ALL_STACKS="$STACK_ADMIN_UI $STACK_PHASE3 $STACK_MOSAIC_API $STACK_BATCH $STACK_JOB_HANDLER $STACK_MOSAIC_INFRA $STACK_TILE_FLAGS"

# =============================================================================
# Clean existing stacks if requested
# =============================================================================
if [ "$CLEAN_FIRST" = "true" ]; then
    echo "🧹 Cleaning existing stacks (Environment: $ENVIRONMENT)..."
    echo ""

    # Delete stacks one at a time in reverse dependency order
    # This ensures exports are not in use before we try to delete the exporting stack
    for stack in $ALL_STACKS; do
        STATUS=$(aws cloudformation describe-stacks --stack-name $stack --region $REGION --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo "NOT_FOUND")

        if [ "$STATUS" = "NOT_FOUND" ] || [ "$STATUS" = "DELETE_COMPLETE" ]; then
            echo "   $stack: not found (skipping)"
            continue
        fi

        if [ "$STATUS" = "DELETE_IN_PROGRESS" ]; then
            echo "   $stack: already deleting, waiting..."
        else
            echo "   $stack: deleting (was $STATUS)..."
            if ! aws cloudformation delete-stack --stack-name $stack --region $REGION 2>/dev/null; then
                echo "   ⚠️  Failed to initiate deletion for $stack"
            fi
        fi

        # Wait for THIS stack to be fully deleted before moving to the next
        # This ensures dependent stacks are gone before we try to delete their dependencies
        echo "   Waiting for $stack to be deleted..."
        while true; do
            STATUS=$(aws cloudformation describe-stacks --stack-name $stack --region $REGION --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo "DELETED")

            if [ "$STATUS" = "DELETED" ] || [ "$STATUS" = "DELETE_COMPLETE" ]; then
                echo "   ✓ $stack deleted"
                break
            elif [ "$STATUS" = "DELETE_FAILED" ]; then
                echo "   ⚠️  $stack: DELETE_FAILED - retrying..."
                aws cloudformation delete-stack --stack-name $stack --region $REGION 2>/dev/null || true
            elif [ "$STATUS" = "DELETE_IN_PROGRESS" ]; then
                sleep 5
            else
                echo "   ⚠️  $stack: unexpected status $STATUS"
                break
            fi
        done
    done

    echo ""
    echo "✅ Cleanup complete"
    echo ""
fi

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

# Auto-detect VPC and subnet IDs if not provided
if [ -z "$VPC_ID" ]; then
    echo "🔍 Auto-detecting default VPC..."
    VPC_ID=$(aws ec2 describe-vpcs --region $REGION --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text)
    if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
        echo "❌ No default VPC found. Please set VPC_ID manually."
        exit 1
    fi
    echo "   Found VPC: $VPC_ID"
fi

if [ -z "$SUBNET_IDS" ]; then
    echo "🔍 Auto-detecting subnets in VPC $VPC_ID..."
    SUBNET_IDS=$(aws ec2 describe-subnets --region $REGION --filters "Name=vpc-id,Values=$VPC_ID" --query "Subnets[*].SubnetId" --output text | tr '\t' ',')
    if [ -z "$SUBNET_IDS" ]; then
        echo "❌ No subnets found in VPC. Please set SUBNET_IDS manually."
        exit 1
    fi
    echo "   Found subnets: $SUBNET_IDS"
fi

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
        UseExistingBucket="$USE_EXISTING_RESOURCES" \
        ExistingTilesBucketName="$EXISTING_TILES_BUCKET" \
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
echo "Phase 3: Deploying Job Handler (EventBridge + Lambda)"
echo "====================================================================="
echo ""

# Package job handler Lambda
echo "📦 Packaging job handler Lambda..."
cd lambda
zip -q -r ../job_completed.zip job_completed.py
cd ..

# Deploy job handler
echo "🏗️  Deploying job handler stack..."
aws cloudformation deploy \
    --template-file cloudformation/job-handler.yaml \
    --stack-name $STACK_JOB_HANDLER \
    --parameter-overrides \
        Environment=$ENVIRONMENT \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

if [ $? -eq 0 ]; then
    echo "✅ Job handler deployed"
else
    echo "❌ Job handler deployment failed"
    exit 1
fi

# Update job handler Lambda code
echo "📤 Updating job handler Lambda code..."
JOB_COMPLETED_FN=$(aws cloudformation describe-stacks --stack-name $STACK_JOB_HANDLER --query "Stacks[0].Outputs[?OutputKey=='JobCompletedFunctionName'].OutputValue" --output text --region $REGION)
aws lambda update-function-code --function-name $JOB_COMPLETED_FN --zip-file fileb://job_completed.zip --region $REGION > /dev/null
rm -f job_completed.zip

echo ""
echo "====================================================================="
echo "Phase 4: Deploying Batch Infrastructure (ECR + Batch)"
echo "====================================================================="
echo ""

# Check VPC configuration
if [ -z "$VPC_ID" ] || [ -z "$SUBNET_IDS" ]; then
    echo "⚠️  VPC_ID and SUBNET_IDS not provided. Skipping Batch deployment."
    echo "   Set VPC_ID and SUBNET_IDS environment variables to deploy Batch."
    echo "   Example: VPC_ID=vpc-xxx SUBNET_IDS=subnet-xxx,subnet-yyy ./deploy-cloud.sh"
    echo ""
    SKIP_BATCH=true
else
    SKIP_BATCH=false
    echo "VPC ID: $VPC_ID"
    echo "Subnets: $SUBNET_IDS"
fi

if [ "$SKIP_BATCH" = "false" ]; then
    # Deploy Batch infrastructure
    echo "🏗️  Deploying Batch infrastructure stack..."
    aws cloudformation deploy \
        --template-file cloudformation/batch-infrastructure.yaml \
        --stack-name $STACK_BATCH \
        --parameter-overrides \
            Environment=$ENVIRONMENT \
            VpcId="$VPC_ID" \
            SubnetIds="$SUBNET_IDS" \
            UseExistingECR="$USE_EXISTING_RESOURCES" \
        --capabilities CAPABILITY_NAMED_IAM \
        --region $REGION

    if [ $? -eq 0 ]; then
        echo "✅ Batch infrastructure deployed"
    else
        echo "❌ Batch infrastructure deployment failed"
        exit 1
    fi
else
    echo "⏭️  Skipping Batch deployment"
fi

echo ""
echo "====================================================================="
echo "Phase 5: Deploying Mosaic API (Lambda + API Gateway)"
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
echo "Phase 6: Deploying Phase 3 Enhancements (Additional APIs)"
echo "====================================================================="
echo ""

# Package Phase 3 Lambda functions
echo "📦 Packaging Phase 3 Lambda functions..."
cd lambda/mosaic

zip -q -r ../../set_main_mosaic.zip set_main_mosaic.py
zip -q -r ../../list_jobs.zip list_jobs.py
zip -q -r ../../get_upload_url.zip get_upload_url.py
zip -q -r ../../cancel_job.zip cancel_job.py

cd ../..

# Deploy Phase 3 stack
echo "🏗️  Deploying Phase 3 enhancements stack..."
aws cloudformation deploy \
    --template-file cloudformation/phase3-enhancements.yaml \
    --stack-name $STACK_PHASE3 \
    --parameter-overrides \
        Environment=$ENVIRONMENT \
        CorsOrigin="$CORS_ORIGIN" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

if [ $? -eq 0 ]; then
    echo "✅ Phase 3 enhancements deployed"
else
    echo "❌ Phase 3 enhancements deployment failed"
    exit 1
fi

# Update Phase 3 Lambda code
echo "📤 Updating Phase 3 Lambda code..."
SET_MAIN_FN=$(aws cloudformation describe-stacks --stack-name $STACK_PHASE3 --query "Stacks[0].Outputs[?OutputKey=='SetMainMosaicFunctionName'].OutputValue" --output text --region $REGION)
LIST_JOBS_FN=$(aws cloudformation describe-stacks --stack-name $STACK_PHASE3 --query "Stacks[0].Outputs[?OutputKey=='ListJobsFunctionName'].OutputValue" --output text --region $REGION)
UPLOAD_URL_FN=$(aws cloudformation describe-stacks --stack-name $STACK_PHASE3 --query "Stacks[0].Outputs[?OutputKey=='GetUploadUrlFunctionName'].OutputValue" --output text --region $REGION)
CANCEL_JOB_FN=$(aws cloudformation describe-stacks --stack-name $STACK_PHASE3 --query "Stacks[0].Outputs[?OutputKey=='CancelJobFunctionName'].OutputValue" --output text --region $REGION)

aws lambda update-function-code --function-name $SET_MAIN_FN --zip-file fileb://set_main_mosaic.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $LIST_JOBS_FN --zip-file fileb://list_jobs.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $UPLOAD_URL_FN --zip-file fileb://get_upload_url.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $CANCEL_JOB_FN --zip-file fileb://cancel_job.zip --region $REGION > /dev/null

rm -f set_main_mosaic.zip list_jobs.zip get_upload_url.zip cancel_job.zip

echo ""
echo "====================================================================="
echo "Phase 7: Deploying Domain Certificate (if custom domain configured)"
echo "====================================================================="
echo ""

CERTIFICATE_ARN=""
if [ -n "$CUSTOM_DOMAIN" ]; then
    # Validate required parameters
    if [ -z "$HOSTED_ZONE_ID" ]; then
        echo "⚠️  HOSTED_ZONE_ID is required for custom domain setup."
        echo "   You can find it with: aws route53 list-hosted-zones"
        read -p "Enter Route 53 Hosted Zone ID for $ROOT_DOMAIN: " HOSTED_ZONE_ID
        if [ -z "$HOSTED_ZONE_ID" ]; then
            echo "❌ Hosted Zone ID is required for custom domain"
            exit 1
        fi
    fi

    # Deploy certificate in us-east-1 (required for CloudFront)
    echo "🏗️  Deploying SSL certificate in us-east-1..."
    aws cloudformation deploy \
        --template-file cloudformation/domain-certificate.yaml \
        --stack-name $STACK_CERTIFICATE \
        --parameter-overrides \
            Environment=$ENVIRONMENT \
            RootDomain="$ROOT_DOMAIN" \
            HostedZoneId="$HOSTED_ZONE_ID" \
        --region us-east-1

    if [ $? -eq 0 ]; then
        echo "✅ Certificate deployed"
    else
        echo "❌ Certificate deployment failed"
        exit 1
    fi

    # Get certificate ARN
    CERTIFICATE_ARN=$(aws cloudformation describe-stacks --stack-name $STACK_CERTIFICATE --query "Stacks[0].Outputs[?OutputKey=='CertificateArn'].OutputValue" --output text --region us-east-1)
    echo "   Certificate ARN: $CERTIFICATE_ARN"
else
    echo "⏭️  Skipping certificate deployment (no CUSTOM_DOMAIN set)"
fi

echo ""
echo "====================================================================="
echo "Phase 8: Deploying Admin UI"
echo "====================================================================="
echo ""

echo "🏗️  Deploying Admin UI stack..."
if [ -n "$CUSTOM_DOMAIN" ] && [ -n "$CERTIFICATE_ARN" ]; then
    aws cloudformation deploy \
        --template-file cloudformation/admin-ui-infrastructure.yaml \
        --stack-name $STACK_ADMIN_UI \
        --parameter-overrides \
            Environment=$ENVIRONMENT \
            CustomDomain="$CUSTOM_DOMAIN" \
            CertificateArn="$CERTIFICATE_ARN" \
            HostedZoneId="$HOSTED_ZONE_ID" \
        --region $REGION
else
    aws cloudformation deploy \
        --template-file cloudformation/admin-ui-infrastructure.yaml \
        --stack-name $STACK_ADMIN_UI \
        --parameter-overrides \
            Environment=$ENVIRONMENT \
        --region $REGION
fi

if [ $? -eq 0 ]; then
    echo "✅ Admin UI deployed"
else
    echo "❌ Admin UI deployment failed"
    exit 1
fi

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

if [ "$SKIP_BATCH" = "false" ]; then
    ECR_URI=$(aws cloudformation describe-stacks --stack-name $STACK_BATCH --query "Stacks[0].Outputs[?OutputKey=='ECRRepositoryUri'].OutputValue" --output text --region $REGION)
    JOB_QUEUE=$(aws cloudformation describe-stacks --stack-name $STACK_BATCH --query "Stacks[0].Outputs[?OutputKey=='BatchJobQueueName'].OutputValue" --output text --region $REGION)
fi

# Get Admin UI URL
ADMIN_UI_URL=$(aws cloudformation describe-stacks --stack-name $STACK_ADMIN_UI --query "Stacks[0].Outputs[?OutputKey=='CloudFrontURL'].OutputValue" --output text --region $REGION)
if [ -n "$CUSTOM_DOMAIN" ]; then
    ADMIN_UI_URL="https://$CUSTOM_DOMAIN"
fi

echo "🎯 API Gateway URL: $API_URL"
echo "🪣 S3 Tiles Bucket: $TILES_BUCKET"
echo "👤 Cognito User Pool ID: $USER_POOL_ID"
echo "🔑 Cognito Client ID: $USER_POOL_CLIENT_ID"
echo "🌐 Admin UI URL: $ADMIN_UI_URL"
if [ "$SKIP_BATCH" = "false" ]; then
    echo "🐳 ECR Repository: $ECR_URI"
    echo "⚙️  Batch Job Queue: $JOB_QUEUE"
fi
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
echo "    GET    $API_URL/mosaics/{id}              - Get mosaic details (add ?include_jobs=true for history)"
echo "    PUT    $API_URL/mosaics/{id}              - Update mosaic"
echo "    DELETE $API_URL/mosaics/{id}              - Delete mosaic"
echo "    PUT    $API_URL/mosaics/{id}/main         - Set/unset as main mosaic"
echo ""
echo "  Job Management (require Cognito auth):"
echo "    POST   $API_URL/jobs                      - Submit generation job"
echo "    GET    $API_URL/jobs                      - List jobs (filter by status/mosaic_id)"
echo "    GET    $API_URL/jobs/{id}                 - Get job status"
echo "    DELETE $API_URL/jobs/{id}/cancel          - Cancel running job"
echo ""
echo "  File Upload (require Cognito auth):"
echo "    POST   $API_URL/upload-url                - Get presigned URL for S3 upload"
echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "Next steps:"
echo "1. Check your email ($ADMIN_EMAIL) for Cognito temporary password"

if [ "$SKIP_BATCH" = "false" ]; then
    echo "2. Build and push Docker image: ./build-and-push.sh"
    echo "3. Upload source images and tiles to S3 bucket: $TILES_BUCKET"
    echo "4. Test mosaic generation by submitting a job via API"
    echo "5. Update frontend to use these API endpoints"
    echo "6. Configure CloudFront for the S3 bucket (Phase 5)"
else
    echo "2. Deploy Batch infrastructure with VPC_ID and SUBNET_IDS"
    echo "3. Update frontend to use these API endpoints"
    echo "4. Configure CloudFront for the S3 bucket"
fi
