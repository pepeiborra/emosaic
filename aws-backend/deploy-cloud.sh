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

# Auto-detect CORS origin based on environment if not explicitly set
if [ -z "$CORS_ORIGIN" ]; then
    if [ "$ENVIRONMENT" = "prod" ]; then
        CORS_ORIGIN="https://casadelmanco.com"
    else
        CORS_ORIGIN="https://${ENVIRONMENT}.casadelmanco.com"
    fi
fi

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
STACK_USER_MGMT="${ENVIRONMENT}-user-management"
STACK_IMAGE_UPLOAD="${ENVIRONMENT}-image-upload"
STACK_CERTIFICATE="${ENVIRONMENT}-domain-certificate"
STACK_ADMIN_UI="${ENVIRONMENT}-admin-ui"

# Stacks in reverse dependency order (for deletion) - main region
ALL_STACKS="$STACK_ADMIN_UI $STACK_IMAGE_UPLOAD $STACK_USER_MGMT $STACK_PHASE3 $STACK_MOSAIC_API $STACK_BATCH $STACK_JOB_HANDLER $STACK_MOSAIC_INFRA $STACK_TILE_FLAGS"

# =============================================================================
# Clean existing stacks if requested
# =============================================================================
if [ "$CLEAN_FIRST" = "true" ]; then
    echo "🧹 Cleaning existing stacks (Environment: $ENVIRONMENT)..."
    echo ""

    # First, delete the certificate stack in us-east-1 (it's a dependency for admin-ui)
    CERT_STATUS=$(aws cloudformation describe-stacks --stack-name $STACK_CERTIFICATE --region us-east-1 --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo "NOT_FOUND")
    if [ "$CERT_STATUS" != "NOT_FOUND" ] && [ "$CERT_STATUS" != "DELETE_COMPLETE" ]; then
        echo "   $STACK_CERTIFICATE (us-east-1): deleting (was $CERT_STATUS)..."
        aws cloudformation delete-stack --stack-name $STACK_CERTIFICATE --region us-east-1 2>/dev/null || true
        echo "   Waiting for $STACK_CERTIFICATE to be deleted..."
        while true; do
            CERT_STATUS=$(aws cloudformation describe-stacks --stack-name $STACK_CERTIFICATE --region us-east-1 --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo "DELETED")
            if [ "$CERT_STATUS" = "DELETED" ] || [ "$CERT_STATUS" = "DELETE_COMPLETE" ]; then
                echo "   ✓ $STACK_CERTIFICATE deleted"
                break
            elif [ "$CERT_STATUS" = "DELETE_FAILED" ] || [ "$CERT_STATUS" = "ROLLBACK_COMPLETE" ]; then
                echo "   ⚠️  $STACK_CERTIFICATE: $CERT_STATUS - retrying..."
                aws cloudformation delete-stack --stack-name $STACK_CERTIFICATE --region us-east-1 2>/dev/null || true
                sleep 5
            elif [ "$CERT_STATUS" = "DELETE_IN_PROGRESS" ]; then
                sleep 5
            else
                echo "   ⚠️  $STACK_CERTIFICATE: unexpected status $CERT_STATUS"
                break
            fi
        done
    else
        echo "   $STACK_CERTIFICATE (us-east-1): not found (skipping)"
    fi

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
            elif [ "$STATUS" = "DELETE_FAILED" ] || [ "$STATUS" = "ROLLBACK_COMPLETE" ]; then
                echo "   ⚠️  $stack: $STATUS - retrying..."
                aws cloudformation delete-stack --stack-name $stack --region $REGION 2>/dev/null || true
                sleep 5
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
        OAuthSecretName="${OAUTH_SECRET_NAME:-${ENVIRONMENT}/casadelmanco/oauth}" \
        CognitoDomainPrefix="${COGNITO_DOMAIN_PREFIX:-casadelmanco-auth}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

if [ $? -eq 0 ]; then
    echo "✅ Mosaic infrastructure deployed"
else
    echo "❌ Mosaic infrastructure deployment failed"
    exit 1
fi

# Update Cognito-trigger Lambda code (custom message, pre-signup, post-confirmation)
echo "📤 Updating Cognito trigger Lambda code..."
cd lambda/mosaic
zip -q -r ../../custom_message.zip custom_message.py
zip -q -r ../../pre_signup.zip pre_signup.py
zip -q -r ../../post_confirmation.zip post_confirmation.py
cd ../..

for entry in \
    "CustomMessageFunctionName:custom_message.zip:Custom Message" \
    "PreSignUpFunctionName:pre_signup.zip:Pre-Sign-Up" \
    "PostConfirmationFunctionName:post_confirmation.zip:Post-Confirmation"; do
    OUTPUT_KEY="${entry%%:*}"
    REST="${entry#*:}"
    ZIP_FILE="${REST%%:*}"
    LABEL="${REST#*:}"
    FN=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_INFRA --query "Stacks[0].Outputs[?OutputKey=='$OUTPUT_KEY'].OutputValue" --output text --region $REGION 2>/dev/null || echo "")
    if [ -n "$FN" ] && [ "$FN" != "None" ]; then
        aws lambda update-function-code --function-name $FN --zip-file fileb://$ZIP_FILE --region $REGION > /dev/null
        echo "✅ $LABEL Lambda code updated"
    else
        echo "⚠️  $LABEL Lambda not found (may not be deployed yet)"
    fi
done

rm -f custom_message.zip pre_signup.zip post_confirmation.zip

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
    # Deploy Batch infrastructure.
    # Wrap in `if` so the aws CLI's non-zero exit doesn't trip the script's
    # set -e — we want the failure to be non-fatal so later phases still run.
    echo "🏗️  Deploying Batch infrastructure stack..."
    if aws cloudformation deploy \
        --template-file cloudformation/batch-infrastructure.yaml \
        --stack-name $STACK_BATCH \
        --parameter-overrides \
            Environment=$ENVIRONMENT \
            VpcId="$VPC_ID" \
            SubnetIds="$SUBNET_IDS" \
            UseExistingECR="$USE_EXISTING_RESOURCES" \
        --capabilities CAPABILITY_NAMED_IAM \
        --region $REGION; then
        echo "✅ Batch infrastructure deployed"
    else
        # Non-fatal: subsequent phases consume Batch's existing CF exports.
        # As long as a previous Batch deploy succeeded once, the exports are
        # still valid even when an update rolls back. Common cause of failure
        # here is the BatchJobDefinition trying to publish a new revision while
        # the previous ARN is still imported by prod-mosaic-api.
        echo "❌ Batch infrastructure deployment failed — continuing with later phases."
        echo "   See: AWS_PROFILE=admin aws cloudformation describe-stack-events --stack-name $STACK_BATCH --region $REGION"
        BATCH_DEPLOY_FAILED=true
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
zip -q -r ../../get_tile_count.zip get_tile_count.py
zip -q -r ../../list_tile_folders.zip list_tile_folders.py
zip -q -r ../../log_error.zip log_error.py
zip -q -r ../../list_errors.zip list_errors.py

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
GET_TILE_COUNT_FN=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_API --query "Stacks[0].Outputs[?OutputKey=='GetTileCountFunctionName'].OutputValue" --output text --region $REGION)
LIST_TILE_FOLDERS_FN=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_API --query "Stacks[0].Outputs[?OutputKey=='ListTileFoldersFunctionName'].OutputValue" --output text --region $REGION)
LOG_ERROR_FN=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_API --query "Stacks[0].Outputs[?OutputKey=='LogErrorFunctionName'].OutputValue" --output text --region $REGION)
LIST_ERRORS_FN=$(aws cloudformation describe-stacks --stack-name $STACK_MOSAIC_API --query "Stacks[0].Outputs[?OutputKey=='ListErrorsFunctionName'].OutputValue" --output text --region $REGION)

aws lambda update-function-code --function-name $LIST_FN --zip-file fileb://list_mosaics.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $GET_FN --zip-file fileb://get_mosaic.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $CREATE_FN --zip-file fileb://create_mosaic.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $UPDATE_FN --zip-file fileb://update_mosaic.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $DELETE_FN --zip-file fileb://delete_mosaic.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $SUBMIT_FN --zip-file fileb://submit_job.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $GETJOB_FN --zip-file fileb://get_job.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $GET_TILE_COUNT_FN --zip-file fileb://get_tile_count.zip --region $REGION > /dev/null
aws lambda update-function-code --function-name $LIST_TILE_FOLDERS_FN --zip-file fileb://list_tile_folders.zip --region $REGION > /dev/null
if [ -n "$LOG_ERROR_FN" ] && [ "$LOG_ERROR_FN" != "None" ]; then
    aws lambda update-function-code --function-name $LOG_ERROR_FN --zip-file fileb://log_error.zip --region $REGION > /dev/null
fi
if [ -n "$LIST_ERRORS_FN" ] && [ "$LIST_ERRORS_FN" != "None" ]; then
    aws lambda update-function-code --function-name $LIST_ERRORS_FN --zip-file fileb://list_errors.zip --region $REGION > /dev/null
fi

rm -f list_mosaics.zip get_mosaic.zip create_mosaic.zip update_mosaic.zip delete_mosaic.zip submit_job.zip get_job.zip get_tile_count.zip list_tile_folders.zip log_error.zip list_errors.zip

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
echo "Phase 6.5: Deploying User Management API"
echo "====================================================================="
echo ""

# Package user management Lambda functions
echo "📦 Packaging user management Lambda functions..."
cd lambda/mosaic
zip -q -r ../../user_management.zip user_management.py
zip -q -r ../../captcha.zip captcha.py
# Include captcha.py in registration.zip since registration.py imports from it
zip -q -r ../../registration.zip registration.py captcha.py
cd ../..

# Deploy user management stack
echo "🏗️  Deploying user management stack..."
aws cloudformation deploy \
    --template-file cloudformation/user-management.yaml \
    --stack-name $STACK_USER_MGMT \
    --parameter-overrides \
        Environment=$ENVIRONMENT \
        CorsOrigin="$CORS_ORIGIN" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

if [ $? -eq 0 ]; then
    echo "✅ User management deployed"
else
    echo "❌ User management deployment failed"
    exit 1
fi

# Update user management Lambda code
echo "📤 Updating user management Lambda code..."
USER_MGMT_FN=$(aws cloudformation describe-stacks --stack-name $STACK_USER_MGMT --query "Stacks[0].Outputs[?OutputKey=='UserManagementFunctionName'].OutputValue" --output text --region $REGION)
aws lambda update-function-code --function-name $USER_MGMT_FN --zip-file fileb://user_management.zip --region $REGION > /dev/null

# Update captcha Lambda code
echo "📤 Updating captcha Lambda code..."
CAPTCHA_FN=$(aws cloudformation describe-stacks --stack-name $STACK_USER_MGMT --query "Stacks[0].Outputs[?OutputKey=='CaptchaFunctionName'].OutputValue" --output text --region $REGION)
if [ -n "$CAPTCHA_FN" ] && [ "$CAPTCHA_FN" != "None" ]; then
    aws lambda update-function-code --function-name $CAPTCHA_FN --zip-file fileb://captcha.zip --region $REGION > /dev/null
    echo "✅ Captcha Lambda code updated"
else
    echo "⚠️  Captcha Lambda not found (may not be deployed yet)"
fi

# Update registration Lambda code
echo "📤 Updating registration Lambda code..."
REGISTRATION_FN=$(aws cloudformation describe-stacks --stack-name $STACK_USER_MGMT --query "Stacks[0].Outputs[?OutputKey=='RegistrationFunctionName'].OutputValue" --output text --region $REGION)
if [ -n "$REGISTRATION_FN" ] && [ "$REGISTRATION_FN" != "None" ]; then
    aws lambda update-function-code --function-name $REGISTRATION_FN --zip-file fileb://registration.zip --region $REGION > /dev/null
    echo "✅ Registration Lambda code updated"
else
    echo "⚠️  Registration Lambda not found (may not be deployed yet)"
fi

rm -f user_management.zip captcha.zip registration.zip

echo ""
echo "====================================================================="
echo "Phase 6.6: Deploying Image Upload API"
echo "====================================================================="
echo ""

# Package image upload Lambda
echo "📦 Packaging image upload Lambda..."
cd lambda/mosaic
zip -q -r ../../image_upload.zip image_upload.py
cd ../..

# Deploy image upload stack
echo "🏗️  Deploying image upload stack..."
aws cloudformation deploy \
    --template-file cloudformation/image-upload.yaml \
    --stack-name $STACK_IMAGE_UPLOAD \
    --parameter-overrides \
        Environment=$ENVIRONMENT \
        CorsOrigin="$CORS_ORIGIN" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

if [ $? -eq 0 ]; then
    echo "✅ Image upload deployed"
else
    echo "❌ Image upload deployment failed"
    exit 1
fi

# Update image upload Lambda code
echo "📤 Updating image upload Lambda code..."
IMAGE_UPLOAD_FN=$(aws cloudformation describe-stacks --stack-name $STACK_IMAGE_UPLOAD --query "Stacks[0].Outputs[?OutputKey=='ImageUploadFunctionName'].OutputValue" --output text --region $REGION)
aws lambda update-function-code --function-name $IMAGE_UPLOAD_FN --zip-file fileb://image_upload.zip --region $REGION > /dev/null

rm -f image_upload.zip

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
            TilesBucketName="$EXISTING_TILES_BUCKET" \
        --region $REGION
else
    aws cloudformation deploy \
        --template-file cloudformation/admin-ui-infrastructure.yaml \
        --stack-name $STACK_ADMIN_UI \
        --parameter-overrides \
            Environment=$ENVIRONMENT \
            TilesBucketName="$EXISTING_TILES_BUCKET" \
        --region $REGION
fi

if [ $? -eq 0 ]; then
    echo "✅ Admin UI S3 bucket deployed"
else
    echo "❌ Admin UI deployment failed"
    exit 1
fi

# Update tiles bucket policy to allow CloudFront access via OAC
echo ""
echo "Updating tiles bucket policy for CloudFront access..."
ADMIN_DISTRIBUTION_ID=$(aws cloudformation describe-stacks --stack-name $STACK_ADMIN_UI --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" --output text --region $REGION)
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Check if policy already has a statement for this distribution
EXISTING_POLICY=$(aws s3api get-bucket-policy --bucket $EXISTING_TILES_BUCKET --query Policy --output text 2>/dev/null || echo "")

if echo "$EXISTING_POLICY" | grep -q "$ADMIN_DISTRIBUTION_ID" 2>/dev/null; then
    echo "   Tiles bucket policy already configured for this distribution. Skipping."
else
    # Create the new policy statement
    NEW_STATEMENT="{\"Sid\":\"AllowCloudFrontServicePrincipal-${ENVIRONMENT}\",\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"cloudfront.amazonaws.com\"},\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::${EXISTING_TILES_BUCKET}/*\",\"Condition\":{\"StringEquals\":{\"AWS:SourceArn\":\"arn:aws:cloudfront::${AWS_ACCOUNT_ID}:distribution/${ADMIN_DISTRIBUTION_ID}\"}}}"

    if [ -z "$EXISTING_POLICY" ]; then
        # No existing policy - create new one
        UPDATED_POLICY="{\"Version\":\"2012-10-17\",\"Statement\":[$NEW_STATEMENT]}"
    else
        # Merge with existing policy
        UPDATED_POLICY=$(echo "$EXISTING_POLICY" | jq --argjson stmt "$NEW_STATEMENT" '.Statement += [$stmt]')
    fi

    # Write to temp file and apply
    echo "$UPDATED_POLICY" > /tmp/tiles-bucket-policy-${ENVIRONMENT}.json
    if aws s3api put-bucket-policy --bucket $EXISTING_TILES_BUCKET --policy file:///tmp/tiles-bucket-policy-${ENVIRONMENT}.json; then
        echo "   ✅ Tiles bucket policy updated for CloudFront access"
    else
        echo "   ⚠️  Failed to update tiles bucket policy. You may need to add it manually."
        echo "   Policy statement needed:"
        echo "$NEW_STATEMENT" | jq .
    fi
    rm -f /tmp/tiles-bucket-policy-${ENVIRONMENT}.json
fi

# Only add /admin/* route to main CloudFront for prod (when no custom domain)
# Environments with CUSTOM_DOMAIN have their own CloudFront distribution
if [ -z "$CUSTOM_DOMAIN" ]; then
    MAIN_DISTRIBUTION_ID="${MAIN_DISTRIBUTION_ID:-E2KW8FQIKWXD1D}"
    ADMIN_BUCKET="emosaic-admin-${ENVIRONMENT}"
    ADMIN_WEBSITE_DOMAIN="${ADMIN_BUCKET}.s3-website.${REGION}.amazonaws.com"
    TILES_BUCKET_DOMAIN="${EXISTING_TILES_BUCKET}.s3.${REGION}.amazonaws.com"
    REDIRECT_FUNCTION_NAME="${ENVIRONMENT}-admin-redirect"

    echo ""
    echo "Setting up /admin redirect function..."

    # Create or update the CloudFront Function for /admin -> /admin/ redirect
    # Write function code to a temp file (AWS CLI reads from file to avoid base64 issues)
    cat > /tmp/admin-redirect-function-${ENVIRONMENT}.js << 'FUNCEOF'
function handler(event) {
  return {
    statusCode: 301,
    statusDescription: "Moved Permanently",
    headers: {
      "location": { value: "/admin/" }
    }
  };
}
FUNCEOF

    # Check if function exists
    EXISTING_FUNCTION=$(aws cloudfront list-functions --query "FunctionList.Items[?Name=='${REDIRECT_FUNCTION_NAME}'].FunctionMetadata.FunctionARN" --output text 2>/dev/null || echo "")

    if [ -n "$EXISTING_FUNCTION" ] && [ "$EXISTING_FUNCTION" != "None" ]; then
        echo "   Updating existing redirect function..."
        # Get the ETag for update
        FUNC_ETAG=$(aws cloudfront describe-function --name "$REDIRECT_FUNCTION_NAME" --query 'ETag' --output text)
        aws cloudfront update-function \
            --name "$REDIRECT_FUNCTION_NAME" \
            --function-config Comment="Redirect /admin to /admin/",Runtime=cloudfront-js-2.0 \
            --function-code fileb:///tmp/admin-redirect-function-${ENVIRONMENT}.js \
            --if-match "$FUNC_ETAG" > /dev/null
        # Publish the function
        FUNC_ETAG=$(aws cloudfront describe-function --name "$REDIRECT_FUNCTION_NAME" --query 'ETag' --output text)
        aws cloudfront publish-function --name "$REDIRECT_FUNCTION_NAME" --if-match "$FUNC_ETAG" > /dev/null
        REDIRECT_FUNCTION_ARN=$(aws cloudfront describe-function --name "$REDIRECT_FUNCTION_NAME" --stage LIVE --query 'FunctionSummary.FunctionMetadata.FunctionARN' --output text)
    else
        echo "   Creating redirect function..."
        aws cloudfront create-function \
            --name "$REDIRECT_FUNCTION_NAME" \
            --function-config Comment="Redirect /admin to /admin/",Runtime=cloudfront-js-2.0 \
            --function-code fileb:///tmp/admin-redirect-function-${ENVIRONMENT}.js > /dev/null
        # Publish the function
        FUNC_ETAG=$(aws cloudfront describe-function --name "$REDIRECT_FUNCTION_NAME" --query 'ETag' --output text)
        aws cloudfront publish-function --name "$REDIRECT_FUNCTION_NAME" --if-match "$FUNC_ETAG" > /dev/null
        REDIRECT_FUNCTION_ARN=$(aws cloudfront describe-function --name "$REDIRECT_FUNCTION_NAME" --stage LIVE --query 'FunctionSummary.FunctionMetadata.FunctionARN' --output text)
    fi
    rm -f /tmp/admin-redirect-function-${ENVIRONMENT}.js
    echo "   ✅ Redirect function ready: $REDIRECT_FUNCTION_ARN"

    echo ""
    echo "Adding /admin/* route to main CloudFront distribution ($MAIN_DISTRIBUTION_ID)..."
    echo "Admin S3 website domain: $ADMIN_WEBSITE_DOMAIN"

    # Get current distribution config
    aws cloudfront get-distribution-config --id $MAIN_DISTRIBUTION_ID > /tmp/cf-config-${ENVIRONMENT}.json
    ETAG=$(jq -r '.ETag' /tmp/cf-config-${ENVIRONMENT}.json)
    jq '.DistributionConfig' /tmp/cf-config-${ENVIRONMENT}.json > /tmp/cf-dist-config-${ENVIRONMENT}.json

    # Check current origin domain
    CURRENT_ORIGIN_DOMAIN=$(jq -r '.Origins.Items[] | select(.Id == "AdminUIOrigin") | .DomainName' /tmp/cf-dist-config-${ENVIRONMENT}.json 2>/dev/null || echo "")

    if [ -n "$CURRENT_ORIGIN_DOMAIN" ] && [ "$CURRENT_ORIGIN_DOMAIN" != "$ADMIN_WEBSITE_DOMAIN" ]; then
        echo "   Updating AdminUIOrigin domain from $CURRENT_ORIGIN_DOMAIN to $ADMIN_WEBSITE_DOMAIN..."

        # Update the origin domain
        jq --arg domain "$ADMIN_WEBSITE_DOMAIN" '
          .Origins.Items = [.Origins.Items[] | if .Id == "AdminUIOrigin" then .DomainName = $domain else . end]
        ' /tmp/cf-dist-config-${ENVIRONMENT}.json > /tmp/cf-dist-config-final-${ENVIRONMENT}.json

        aws cloudfront update-distribution \
            --id $MAIN_DISTRIBUTION_ID \
            --distribution-config file:///tmp/cf-dist-config-final-${ENVIRONMENT}.json \
            --if-match $ETAG > /dev/null
        echo "   ✅ AdminUIOrigin domain updated"

        # Re-fetch config for next updates
        aws cloudfront get-distribution-config --id $MAIN_DISTRIBUTION_ID > /tmp/cf-config-${ENVIRONMENT}.json
        ETAG=$(jq -r '.ETag' /tmp/cf-config-${ENVIRONMENT}.json)
        jq '.DistributionConfig' /tmp/cf-config-${ENVIRONMENT}.json > /tmp/cf-dist-config-${ENVIRONMENT}.json
    elif [ -n "$CURRENT_ORIGIN_DOMAIN" ]; then
        echo "   /admin/* origin already configured correctly."
    else
        echo "   Adding AdminUIOrigin and /admin/* cache behavior..."

        # Add the new origin (using S3 website endpoint for SPA support)
        jq --arg domain "$ADMIN_WEBSITE_DOMAIN" '
          .Origins.Items += [{
            "Id": "AdminUIOrigin",
            "DomainName": $domain,
            "OriginPath": "",
            "CustomHeaders": {"Quantity": 0},
            "CustomOriginConfig": {
              "HTTPPort": 80,
              "HTTPSPort": 443,
              "OriginProtocolPolicy": "http-only",
              "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]},
              "OriginReadTimeout": 30,
              "OriginKeepaliveTimeout": 5
            },
            "ConnectionAttempts": 3,
            "ConnectionTimeout": 10,
            "OriginShield": {"Enabled": false}
          }] |
          .Origins.Quantity = (.Origins.Items | length)
        ' /tmp/cf-dist-config-${ENVIRONMENT}.json > /tmp/cf-dist-config-with-origin-${ENVIRONMENT}.json

        # Add the cache behavior for /admin/*
        jq '
          .CacheBehaviors.Items = [{
            "PathPattern": "/admin/*",
            "TargetOriginId": "AdminUIOrigin",
            "ViewerProtocolPolicy": "redirect-to-https",
            "AllowedMethods": {
              "Quantity": 2,
              "Items": ["HEAD", "GET"],
              "CachedMethods": {"Quantity": 2, "Items": ["HEAD", "GET"]}
            },
            "Compress": true,
            "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
            "SmoothStreaming": false,
            "FieldLevelEncryptionId": "",
            "FunctionAssociations": {"Quantity": 0, "Items": []},
            "LambdaFunctionAssociations": {"Quantity": 0, "Items": []}
          }] + .CacheBehaviors.Items |
          .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)
        ' /tmp/cf-dist-config-with-origin-${ENVIRONMENT}.json > /tmp/cf-dist-config-final-${ENVIRONMENT}.json

        aws cloudfront update-distribution \
            --id $MAIN_DISTRIBUTION_ID \
            --distribution-config file:///tmp/cf-dist-config-final-${ENVIRONMENT}.json \
            --if-match $ETAG > /dev/null
        echo "   ✅ AdminUIOrigin and /admin/* route added to CloudFront"

        # Re-fetch config for next updates
        aws cloudfront get-distribution-config --id $MAIN_DISTRIBUTION_ID > /tmp/cf-config-${ENVIRONMENT}.json
        ETAG=$(jq -r '.ETag' /tmp/cf-config-${ENVIRONMENT}.json)
        jq '.DistributionConfig' /tmp/cf-config-${ENVIRONMENT}.json > /tmp/cf-dist-config-${ENVIRONMENT}.json
    fi

    # Now check if /admin (exact) behavior exists and add it with redirect function
    ADMIN_EXACT_BEHAVIOR=$(jq -r '.CacheBehaviors.Items[] | select(.PathPattern == "/admin") | .PathPattern' /tmp/cf-dist-config-${ENVIRONMENT}.json 2>/dev/null || echo "")

    if [ -z "$ADMIN_EXACT_BEHAVIOR" ]; then
        echo "   Adding /admin redirect behavior..."

        # Add cache behavior for /admin (exact match) with redirect function
        jq --arg funcArn "$REDIRECT_FUNCTION_ARN" '
          .CacheBehaviors.Items = [{
            "PathPattern": "/admin",
            "TargetOriginId": "AdminUIOrigin",
            "ViewerProtocolPolicy": "redirect-to-https",
            "AllowedMethods": {
              "Quantity": 2,
              "Items": ["HEAD", "GET"],
              "CachedMethods": {"Quantity": 2, "Items": ["HEAD", "GET"]}
            },
            "Compress": true,
            "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
            "SmoothStreaming": false,
            "FieldLevelEncryptionId": "",
            "FunctionAssociations": {
              "Quantity": 1,
              "Items": [{
                "EventType": "viewer-request",
                "FunctionARN": $funcArn
              }]
            },
            "LambdaFunctionAssociations": {"Quantity": 0, "Items": []}
          }] + .CacheBehaviors.Items |
          .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)
        ' /tmp/cf-dist-config-${ENVIRONMENT}.json > /tmp/cf-dist-config-final-${ENVIRONMENT}.json

        aws cloudfront update-distribution \
            --id $MAIN_DISTRIBUTION_ID \
            --distribution-config file:///tmp/cf-dist-config-final-${ENVIRONMENT}.json \
            --if-match $ETAG > /dev/null
        echo "   ✅ /admin redirect behavior added"
    else
        echo "   /admin redirect behavior already exists."
    fi

    # Now add TilesOrigin and /mosaics/*, /tiles/* behaviors for serving mosaic artifacts
    echo ""
    echo "Setting up tiles origin and behaviors for /mosaics/* and /tiles/*..."

    # Get or create Origin Access Control for tiles bucket
    TILES_OAC_NAME="${ENVIRONMENT}-main-tiles-oac"
    TILES_OAC_ID=$(aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name=='${TILES_OAC_NAME}'].Id" --output text 2>/dev/null || echo "")

    if [ -z "$TILES_OAC_ID" ] || [ "$TILES_OAC_ID" = "None" ]; then
        echo "   Creating Origin Access Control for tiles bucket..."
        TILES_OAC_ID=$(aws cloudfront create-origin-access-control \
            --origin-access-control-config "Name=${TILES_OAC_NAME},Description=OAC for tiles bucket access from main CloudFront,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
            --query 'OriginAccessControl.Id' --output text)
        echo "   ✅ Created OAC: $TILES_OAC_ID"
    else
        echo "   ✅ Using existing OAC: $TILES_OAC_ID"
    fi

    # Re-fetch config for tiles origin updates
    aws cloudfront get-distribution-config --id $MAIN_DISTRIBUTION_ID > /tmp/cf-config-${ENVIRONMENT}.json
    ETAG=$(jq -r '.ETag' /tmp/cf-config-${ENVIRONMENT}.json)
    jq '.DistributionConfig' /tmp/cf-config-${ENVIRONMENT}.json > /tmp/cf-dist-config-${ENVIRONMENT}.json

    # Check if TilesOrigin already exists
    TILES_ORIGIN_EXISTS=$(jq -r '.Origins.Items[] | select(.Id == "TilesOrigin") | .Id' /tmp/cf-dist-config-${ENVIRONMENT}.json 2>/dev/null || echo "")

    if [ -z "$TILES_ORIGIN_EXISTS" ]; then
        echo "   Adding TilesOrigin..."

        # Add the TilesOrigin with OAC
        jq --arg domain "$TILES_BUCKET_DOMAIN" --arg oacId "$TILES_OAC_ID" '
          .Origins.Items += [{
            "Id": "TilesOrigin",
            "DomainName": $domain,
            "OriginPath": "",
            "CustomHeaders": {"Quantity": 0},
            "S3OriginConfig": {
              "OriginAccessIdentity": ""
            },
            "ConnectionAttempts": 3,
            "ConnectionTimeout": 10,
            "OriginShield": {"Enabled": false},
            "OriginAccessControlId": $oacId
          }] |
          .Origins.Quantity = (.Origins.Items | length)
        ' /tmp/cf-dist-config-${ENVIRONMENT}.json > /tmp/cf-dist-config-with-tiles-origin-${ENVIRONMENT}.json

        aws cloudfront update-distribution \
            --id $MAIN_DISTRIBUTION_ID \
            --distribution-config file:///tmp/cf-dist-config-with-tiles-origin-${ENVIRONMENT}.json \
            --if-match $ETAG > /dev/null
        echo "   ✅ TilesOrigin added to CloudFront"

        # Re-fetch config
        aws cloudfront get-distribution-config --id $MAIN_DISTRIBUTION_ID > /tmp/cf-config-${ENVIRONMENT}.json
        ETAG=$(jq -r '.ETag' /tmp/cf-config-${ENVIRONMENT}.json)
        jq '.DistributionConfig' /tmp/cf-config-${ENVIRONMENT}.json > /tmp/cf-dist-config-${ENVIRONMENT}.json
    else
        echo "   TilesOrigin already exists."
    fi

    # Check if /mosaics/* behavior exists
    MOSAICS_BEHAVIOR=$(jq -r '.CacheBehaviors.Items[] | select(.PathPattern == "/mosaics/*") | .PathPattern' /tmp/cf-dist-config-${ENVIRONMENT}.json 2>/dev/null || echo "")

    if [ -z "$MOSAICS_BEHAVIOR" ]; then
        echo "   Adding /mosaics/* and /tiles/* cache behaviors..."

        # Add cache behaviors for /mosaics/* and /tiles/*
        jq '
          .CacheBehaviors.Items = [{
            "PathPattern": "/mosaics/*",
            "TargetOriginId": "TilesOrigin",
            "ViewerProtocolPolicy": "redirect-to-https",
            "AllowedMethods": {
              "Quantity": 2,
              "Items": ["HEAD", "GET"],
              "CachedMethods": {"Quantity": 2, "Items": ["HEAD", "GET"]}
            },
            "Compress": true,
            "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
            "SmoothStreaming": false,
            "FieldLevelEncryptionId": "",
            "FunctionAssociations": {"Quantity": 0, "Items": []},
            "LambdaFunctionAssociations": {"Quantity": 0, "Items": []}
          }, {
            "PathPattern": "/tiles/*",
            "TargetOriginId": "TilesOrigin",
            "ViewerProtocolPolicy": "redirect-to-https",
            "AllowedMethods": {
              "Quantity": 2,
              "Items": ["HEAD", "GET"],
              "CachedMethods": {"Quantity": 2, "Items": ["HEAD", "GET"]}
            },
            "Compress": true,
            "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
            "SmoothStreaming": false,
            "FieldLevelEncryptionId": "",
            "FunctionAssociations": {"Quantity": 0, "Items": []},
            "LambdaFunctionAssociations": {"Quantity": 0, "Items": []}
          }, {
            "PathPattern": "/uploads/*",
            "TargetOriginId": "TilesOrigin",
            "ViewerProtocolPolicy": "redirect-to-https",
            "AllowedMethods": {
              "Quantity": 2,
              "Items": ["HEAD", "GET"],
              "CachedMethods": {"Quantity": 2, "Items": ["HEAD", "GET"]}
            },
            "Compress": true,
            "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
            "SmoothStreaming": false,
            "FieldLevelEncryptionId": "",
            "FunctionAssociations": {"Quantity": 0, "Items": []},
            "LambdaFunctionAssociations": {"Quantity": 0, "Items": []}
          }] + .CacheBehaviors.Items |
          .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)
        ' /tmp/cf-dist-config-${ENVIRONMENT}.json > /tmp/cf-dist-config-final-${ENVIRONMENT}.json

        aws cloudfront update-distribution \
            --id $MAIN_DISTRIBUTION_ID \
            --distribution-config file:///tmp/cf-dist-config-final-${ENVIRONMENT}.json \
            --if-match $ETAG > /dev/null
        echo "   ✅ /mosaics/*, /tiles/*, and /uploads/* cache behaviors added"

        # Re-fetch config
        aws cloudfront get-distribution-config --id $MAIN_DISTRIBUTION_ID > /tmp/cf-config-${ENVIRONMENT}.json
        ETAG=$(jq -r '.ETag' /tmp/cf-config-${ENVIRONMENT}.json)
        jq '.DistributionConfig' /tmp/cf-config-${ENVIRONMENT}.json > /tmp/cf-dist-config-${ENVIRONMENT}.json
    else
        echo "   /mosaics/* behavior already exists."
    fi

    # Update tiles bucket policy to allow access from main CloudFront distribution
    echo ""
    echo "Updating tiles bucket policy for main CloudFront access..."
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    EXISTING_TILES_POLICY=$(aws s3api get-bucket-policy --bucket $EXISTING_TILES_BUCKET --query Policy --output text 2>/dev/null || echo "")

    # Check if policy already has a statement for the main distribution
    if echo "$EXISTING_TILES_POLICY" | grep -q "$MAIN_DISTRIBUTION_ID" 2>/dev/null; then
        echo "   Tiles bucket policy already configured for main CloudFront. Skipping."
    else
        NEW_TILES_STATEMENT="{\"Sid\":\"AllowCloudFrontServicePrincipal-main-${ENVIRONMENT}\",\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"cloudfront.amazonaws.com\"},\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::${EXISTING_TILES_BUCKET}/*\",\"Condition\":{\"StringEquals\":{\"AWS:SourceArn\":\"arn:aws:cloudfront::${AWS_ACCOUNT_ID}:distribution/${MAIN_DISTRIBUTION_ID}\"}}}"

        if [ -z "$EXISTING_TILES_POLICY" ]; then
            UPDATED_TILES_POLICY="{\"Version\":\"2012-10-17\",\"Statement\":[$NEW_TILES_STATEMENT]}"
        else
            UPDATED_TILES_POLICY=$(echo "$EXISTING_TILES_POLICY" | jq --argjson stmt "$NEW_TILES_STATEMENT" '.Statement += [$stmt]')
        fi

        echo "$UPDATED_TILES_POLICY" > /tmp/tiles-main-bucket-policy-${ENVIRONMENT}.json
        if aws s3api put-bucket-policy --bucket $EXISTING_TILES_BUCKET --policy file:///tmp/tiles-main-bucket-policy-${ENVIRONMENT}.json; then
            echo "   ✅ Tiles bucket policy updated for main CloudFront access"
        else
            echo "   ⚠️  Failed to update tiles bucket policy. You may need to add it manually."
        fi
        rm -f /tmp/tiles-main-bucket-policy-${ENVIRONMENT}.json
    fi

    # Update default behavior to point to AdminUIOrigin (for the landing page)
    # This allows the "set as main" mosaic feature to update the landing page
    echo ""
    echo "Updating default behavior to serve landing page from admin bucket..."

    # Re-fetch config for default behavior update
    aws cloudfront get-distribution-config --id $MAIN_DISTRIBUTION_ID > /tmp/cf-config-${ENVIRONMENT}.json
    ETAG=$(jq -r '.ETag' /tmp/cf-config-${ENVIRONMENT}.json)
    jq '.DistributionConfig' /tmp/cf-config-${ENVIRONMENT}.json > /tmp/cf-dist-config-${ENVIRONMENT}.json

    # Check current default origin
    CURRENT_DEFAULT_ORIGIN=$(jq -r '.DefaultCacheBehavior.TargetOriginId' /tmp/cf-dist-config-${ENVIRONMENT}.json)

    if [ "$CURRENT_DEFAULT_ORIGIN" != "AdminUIOrigin" ]; then
        echo "   Current default origin: $CURRENT_DEFAULT_ORIGIN"
        echo "   Updating to: AdminUIOrigin"

        # Update the default cache behavior to point to AdminUIOrigin
        jq '.DefaultCacheBehavior.TargetOriginId = "AdminUIOrigin"' /tmp/cf-dist-config-${ENVIRONMENT}.json > /tmp/cf-dist-config-final-${ENVIRONMENT}.json

        aws cloudfront update-distribution \
            --id $MAIN_DISTRIBUTION_ID \
            --distribution-config file:///tmp/cf-dist-config-final-${ENVIRONMENT}.json \
            --if-match $ETAG > /dev/null
        echo "   ✅ Default behavior updated - landing page now served from admin bucket"
        echo "   Note: 'Set as Main' mosaic feature will now update the landing page"
    else
        echo "   Default behavior already points to AdminUIOrigin. Skipping."
    fi

    rm -f /tmp/cf-config-${ENVIRONMENT}.json /tmp/cf-dist-config-${ENVIRONMENT}.json /tmp/cf-dist-config-with-origin-${ENVIRONMENT}.json /tmp/cf-dist-config-with-tiles-origin-${ENVIRONMENT}.json /tmp/cf-dist-config-final-${ENVIRONMENT}.json
else
    echo ""
    echo "Custom domain configured ($CUSTOM_DOMAIN) - admin UI will be served by its own CloudFront distribution"
fi

echo ""
echo "====================================================================="
echo "Phase 9: Redeploy API Gateway"
echo "====================================================================="
echo ""

# API Gateway deployment happens in CloudFormation before Lambda code is uploaded,
# so we need to trigger a new deployment to pick up the updated Lambda code
echo "🔄 Creating new API Gateway deployment..."
API_ID=$(aws cloudformation describe-stacks --stack-name $STACK_TILE_FLAGS --query "Stacks[0].Outputs[?OutputKey=='APIGatewayId'].OutputValue" --output text --region $REGION)

if [ -n "$API_ID" ] && [ "$API_ID" != "None" ]; then
    aws apigateway create-deployment \
        --rest-api-id "$API_ID" \
        --stage-name "$ENVIRONMENT" \
        --description "Deployment after Lambda code update" \
        --region $REGION > /dev/null
    echo "✅ API Gateway redeployed"
else
    echo "⚠️  Could not find API Gateway ID, skipping redeployment"
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

# Admin UI is served from main domain at /admin/
ADMIN_UI_URL="https://casadelmanco.com/admin/"

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
echo "  Image Upload (require Cognito auth):"
echo "    POST   $API_URL/images/upload-urls        - Get presigned URLs for bulk image upload"
echo "    POST   $API_URL/images/check-duplicates   - Check for duplicate images by hash"
echo "    POST   $API_URL/images/confirm            - Confirm successful uploads"
echo ""
echo "  Tiles (require Cognito auth):"
echo "    GET    $API_URL/tiles/count               - Get tile count for validation"
echo "    GET    $API_URL/tiles/folders             - List tile folders"
echo ""
echo "  Error Logging (require Cognito auth):"
echo "    POST   $API_URL/errors                    - Log client-side error"
echo "    GET    $API_URL/errors                    - List error logs"
echo ""
echo "  User Management (require Cognito auth):"
echo "    GET    $API_URL/users                     - List all users"
echo "    POST   $API_URL/users                     - Create new user"
echo "    DELETE $API_URL/users/{username}          - Delete user"
echo "    POST   $API_URL/users/{username}/resend-invite - Resend invite"
echo "    PUT    $API_URL/users/{username}/enable   - Enable user"
echo "    PUT    $API_URL/users/{username}/disable  - Disable user"
echo ""
echo "  Registration (public):"
echo "    GET    $API_URL/captcha                   - Get captcha challenge"
echo "    POST   $API_URL/register                  - Submit registration request"
echo ""
echo "  Registration Management (require Cognito auth):"
echo "    GET    $API_URL/registrations             - List pending registrations"
echo "    POST   $API_URL/registrations/{id}/approve - Approve registration"
echo "    POST   $API_URL/registrations/{id}/reject  - Reject registration"
echo ""
if [ "$BATCH_DEPLOY_FAILED" = "true" ]; then
    echo "⚠️  Deployment finished with Batch failure — other phases applied successfully."
    echo "   Re-investigate the Batch stack before relying on it (mosaic generation jobs)."
else
    echo "🎉 Deployment completed successfully!"
fi
echo ""
echo "Next steps:"
echo "1. Check your email ($ADMIN_EMAIL) for Cognito temporary password"

if [ "$SKIP_BATCH" = "false" ]; then
    echo "2. Build and deploy Admin UI: ./deploy-admin-ui.sh"
    echo "3. Build and push Docker image: ./build-and-push.sh"
    echo "4. Upload source images and tiles to S3 bucket: $TILES_BUCKET"
    echo "5. Test mosaic generation by submitting a job via API"
    echo "6. Update frontend to use these API endpoints"
    echo "   Note: CloudFront changes take 5-15 minutes to propagate"
else
    echo "2. Build and deploy Admin UI: ./deploy-admin-ui.sh"
    echo "3. Deploy Batch infrastructure with VPC_ID and SUBNET_IDS"
    echo "4. Update frontend to use these API endpoints"
    echo "   Note: CloudFront changes take 5-15 minutes to propagate"
fi
