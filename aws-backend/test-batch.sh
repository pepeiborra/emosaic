#!/bin/bash
# Test script for submitting a batch job to the Emosaic API

set -e

ENVIRONMENT=${ENVIRONMENT:-prod}
REGION=${AWS_REGION:-eu-west-3}
TEST_IMAGE=${1:-}

echo "🧪 Emosaic Batch Job Test"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo ""

# Check for test image
if [ -z "$TEST_IMAGE" ]; then
    echo "Usage: ./test-batch.sh <path-to-test-image>"
    echo "Example: ./test-batch.sh ~/photos/test.jpg"
    exit 1
fi

if [ ! -f "$TEST_IMAGE" ]; then
    echo "❌ File not found: $TEST_IMAGE"
    exit 1
fi

# Check AWS CLI
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Run 'aws configure'."
    exit 1
fi

echo "✅ AWS CLI configured"
echo ""

# =============================================================================
# Get AWS Resources
# =============================================================================
echo "📋 Getting AWS resources..."

API_URL=$(aws cloudformation describe-stacks \
    --stack-name "$ENVIRONMENT-tile-flags-infrastructure" \
    --query "Stacks[0].Outputs[?OutputKey=='APIGatewayURL'].OutputValue" \
    --output text --region "$REGION")

BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "$ENVIRONMENT-mosaic-infrastructure" \
    --query "Stacks[0].Outputs[?OutputKey=='TilesBucketName'].OutputValue" \
    --output text --region "$REGION")

USER_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name "$ENVIRONMENT-mosaic-infrastructure" \
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
    --output text --region "$REGION")

CLIENT_ID=$(aws cloudformation describe-stacks \
    --stack-name "$ENVIRONMENT-mosaic-infrastructure" \
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" \
    --output text --region "$REGION")

echo "   API URL: $API_URL"
echo "   S3 Bucket: $BUCKET"
echo "   User Pool: $USER_POOL_ID"
echo ""

# =============================================================================
# Authentication
# =============================================================================
echo "🔐 Authenticating..."

if [ -z "$COGNITO_USERNAME" ] || [ -z "$COGNITO_PASSWORD" ]; then
    echo "   Set COGNITO_USERNAME and COGNITO_PASSWORD environment variables"
    echo "   or enter them now:"
    read -p "   Username (email): " COGNITO_USERNAME
    read -s -p "   Password: " COGNITO_PASSWORD
    echo ""
fi

AUTH_PARAMS=$(printf '{"USERNAME":"%s","PASSWORD":"%s"}' "$COGNITO_USERNAME" "$COGNITO_PASSWORD")
TOKEN=$(aws cognito-idp initiate-auth \
    --client-id "$CLIENT_ID" \
    --auth-flow USER_PASSWORD_AUTH \
    --auth-parameters "$AUTH_PARAMS" \
    --query "AuthenticationResult.IdToken" \
    --output text \
    --region $REGION 2>/dev/null)

if [ -z "$TOKEN" ] || [ "$TOKEN" = "None" ]; then
    echo "❌ Authentication failed. Check your credentials."
    echo "   If this is your first login, you may need to set a permanent password:"
    echo ""
    echo "   aws cognito-idp admin-set-user-password \\"
    echo "     --user-pool-id $USER_POOL_ID \\"
    echo "     --username $COGNITO_USERNAME \\"
    echo "     --password 'YourNewPassword123!' \\"
    echo "     --permanent --region $REGION"
    exit 1
fi

echo "✅ Authenticated"
echo "   Token length: ${#TOKEN}"
echo ""

# =============================================================================
# Upload Test Image
# =============================================================================
FILENAME=$(basename "$TEST_IMAGE")
S3_KEY="uploads/test-$(date +%s)-$FILENAME"

echo "📤 Uploading test image..."
echo "   Source: $TEST_IMAGE"
echo "   Destination: s3://$BUCKET/$S3_KEY"

aws s3 cp "$TEST_IMAGE" "s3://$BUCKET/$S3_KEY" --region $REGION

echo "✅ Image uploaded"
echo ""

# =============================================================================
# Create Mosaic
# =============================================================================
echo "🎨 Creating mosaic record..."

AUTH_HEADER="Authorization: Bearer $TOKEN"

MOSAIC_RESPONSE=$(curl -s -X POST "$API_URL/mosaics" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d '{
        "title": "Test Mosaic '"$(date +%Y-%m-%d-%H%M%S)"'",
        "description": "Automated test mosaic",
        "source_image_path": "s3://'"$BUCKET"'/'"$S3_KEY"'",
        "tiles_dir": "tiles/",
        "tile_size": 32,
        "mode": 16,
        "tint_opacity": 0.5
    }')

MOSAIC_ID=$(echo "$MOSAIC_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))" 2>/dev/null)

if [ -z "$MOSAIC_ID" ]; then
    echo "❌ Failed to create mosaic:"
    echo "$MOSAIC_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$MOSAIC_RESPONSE"
    exit 1
fi

echo "✅ Mosaic created: $MOSAIC_ID"
echo ""

# =============================================================================
# Submit Job
# =============================================================================
echo "🚀 Submitting batch job..."

JOB_RESPONSE=$(curl -s -X POST "$API_URL/jobs" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "mosaic_id": "'"$MOSAIC_ID"'"
    }')

JOB_ID=$(echo "$JOB_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))" 2>/dev/null)
BATCH_JOB_ID=$(echo "$JOB_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('batch_job_id', ''))" 2>/dev/null)

if [ -z "$JOB_ID" ]; then
    echo "❌ Failed to submit job:"
    echo "$JOB_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$JOB_RESPONSE"
    exit 1
fi

echo "✅ Job submitted!"
echo ""
echo "   Job ID: $JOB_ID"
echo "   Batch Job ID: $BATCH_JOB_ID"
echo "   Mosaic ID: $MOSAIC_ID"
echo ""

# =============================================================================
# Monitor Job
# =============================================================================
echo "📊 Checking job status..."
echo "   (Press Ctrl+C to stop monitoring)"
echo ""

while true; do
    STATUS_RESPONSE=$(curl -s "$API_URL/jobs/$JOB_ID" \
        -H "Authorization: Bearer $TOKEN")

    STATUS=$(echo "$STATUS_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', 'unknown'))" 2>/dev/null)

    echo "   $(date +%H:%M:%S) - Status: $STATUS"

    if [ "$STATUS" = "succeeded" ]; then
        echo ""
        echo "✅ Job completed successfully!"
        echo ""
        echo "Output: s3://$BUCKET/mosaics/$MOSAIC_ID/output.html"
        echo ""
        echo "To download the result:"
        echo "   aws s3 cp s3://$BUCKET/mosaics/$MOSAIC_ID/output.html ./mosaic-output.html"
        break
    elif [ "$STATUS" = "failed" ]; then
        echo ""
        echo "❌ Job failed"
        echo "$STATUS_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$STATUS_RESPONSE"
        exit 1
    elif [ "$STATUS" = "cancelled" ]; then
        echo ""
        echo "⚠️  Job was cancelled"
        exit 1
    fi

    sleep 10
done
