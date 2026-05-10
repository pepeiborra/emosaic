#!/bin/bash
#
# Build and deploy the admin UI to S3
#

set -e

ENVIRONMENT="${ENVIRONMENT:-prod}"
REGION="${REGION:-eu-west-3}"
ADMIN_BUCKET="emosaic-admin-${ENVIRONMENT}"
STACK_ADMIN_UI="${ENVIRONMENT}-admin-ui"

echo "====================================================================="
echo "Building and deploying Admin UI"
echo "====================================================================="
echo ""
echo "Environment: $ENVIRONMENT"
echo "S3 Bucket: $ADMIN_BUCKET"
echo "Region: $REGION"
echo ""

# Change to admin-ui directory
cd "$(dirname "$0")/../admin-ui"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build for production using environment-specific .env file.
# Always regenerate: the prior approach of "only if missing" silently
# baked stale CF outputs into the bundle (e.g. shipped without
# VITE_COGNITO_DOMAIN after Cognito Hosted UI was added).
echo ""
ENV_FILE=".env.${ENVIRONMENT}"
echo "Generating $ENV_FILE..."
./generate-env.sh "$ENVIRONMENT" "$REGION"

echo "Building for production with $ENV_FILE..."
# Copy environment-specific file to .env.production for Vite to use
cp "$ENV_FILE" .env.production
npm run build
rm -f .env.production

# Deploy to S3 under /admin/ prefix (matches vite base path)
echo ""
echo "Deploying to S3 bucket: $ADMIN_BUCKET/admin/..."
aws s3 sync dist/ s3://${ADMIN_BUCKET}/admin/ \
    --delete \
    --region $REGION \
    --cache-control "max-age=3600" \
    --exclude "*.html" \
    --exclude "*.json"

# Upload HTML and JSON files with no-cache headers
aws s3 sync dist/ s3://${ADMIN_BUCKET}/admin/ \
    --region $REGION \
    --cache-control "no-cache, no-store, must-revalidate" \
    --content-type "text/html; charset=utf-8" \
    --exclude "*" \
    --include "*.html"

aws s3 sync dist/ s3://${ADMIN_BUCKET}/admin/ \
    --region $REGION \
    --cache-control "no-cache, no-store, must-revalidate" \
    --content-type "application/json; charset=utf-8" \
    --exclude "*" \
    --include "*.json"

# NOTE: We do NOT create a root redirect page here, because the root index.html
# is managed by set_main_mosaic.py which copies the main mosaic widget there.
# Creating a redirect here would overwrite the main mosaic.

# Determine CloudFront distribution(s) to invalidate.
# The emosaic-admin-prod S3 bucket is served by TWO CloudFront distributions in prod:
#   - E2KW8FQIKWXD1D — the main casadelmanco.com distribution (what real users hit at /admin/)
#   - The one exported by ${ENVIRONMENT}-admin-ui (the raw djceloluh236z.cloudfront.net staging URL)
# Both need invalidation or users keep seeing cached old code.
# For non-prod environments, only the stack-specific distribution exists / matters.
if [ -z "$DISTRIBUTION_ID" ]; then
    STACK_CF_ID=$(aws cloudformation describe-stacks --stack-name $STACK_ADMIN_UI --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" --output text --region $REGION 2>/dev/null || echo "")

    if [ "$ENVIRONMENT" = "prod" ]; then
        DISTRIBUTION_ID="E2KW8FQIKWXD1D"
        ADMIN_URL="https://casadelmanco.com/admin/"
        if [ -n "$STACK_CF_ID" ] && [ "$STACK_CF_ID" != "None" ]; then
            EXTRA_DISTRIBUTION_ID="$STACK_CF_ID"
        fi
    elif [ -n "$STACK_CF_ID" ] && [ "$STACK_CF_ID" != "None" ]; then
        DISTRIBUTION_ID="$STACK_CF_ID"
        ADMIN_URL=$(aws cloudformation describe-stacks --stack-name $STACK_ADMIN_UI --query "Stacks[0].Outputs[?OutputKey=='CustomDomainURL'].OutputValue" --output text --region $REGION 2>/dev/null || echo "")
        if [ -z "$ADMIN_URL" ] || [ "$ADMIN_URL" = "None" ]; then
            ADMIN_URL=$(aws cloudformation describe-stacks --stack-name $STACK_ADMIN_UI --query "Stacks[0].Outputs[?OutputKey=='CloudFrontURL'].OutputValue" --output text --region $REGION)
        fi
        ADMIN_URL="${ADMIN_URL}/admin/"
    else
        DISTRIBUTION_ID="E2KW8FQIKWXD1D"
        ADMIN_URL="https://casadelmanco.com/admin/"
    fi
fi

# Create CloudFront invalidation (always /admin/* since files are at that prefix)
echo ""
echo "Creating CloudFront invalidation for distribution $DISTRIBUTION_ID..."
aws cloudfront create-invalidation \
    --distribution-id $DISTRIBUTION_ID \
    --paths "/admin/*"

if [ -n "$EXTRA_DISTRIBUTION_ID" ]; then
    echo "Creating CloudFront invalidation for secondary distribution $EXTRA_DISTRIBUTION_ID..."
    aws cloudfront create-invalidation \
        --distribution-id $EXTRA_DISTRIBUTION_ID \
        --paths "/admin/*"
fi

echo ""
echo "====================================================================="
echo "Admin UI deployed successfully!"
echo "====================================================================="
echo ""
echo "The admin UI will be available at:"
echo "  $ADMIN_URL"
echo ""
echo "Note: CloudFront invalidation can take a few minutes to complete."
echo ""
