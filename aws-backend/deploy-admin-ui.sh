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

# Build for production using environment-specific .env file
echo ""
ENV_FILE=".env.${ENVIRONMENT}"
if [ ! -f "$ENV_FILE" ]; then
    echo "Generating $ENV_FILE..."
    ./generate-env.sh "$ENVIRONMENT" "$REGION"
fi

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

# Create a root redirect page for environments with their own CloudFront (redirects / to /admin/)
echo '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/admin/"></head><body>Redirecting to <a href="/admin/">Admin UI</a>...</body></html>' | \
    aws s3 cp - s3://${ADMIN_BUCKET}/index.html \
    --region $REGION \
    --content-type "text/html; charset=utf-8" \
    --cache-control "no-cache, no-store, must-revalidate"

# Determine CloudFront distribution ID
# - For prod (no custom domain): use main distribution
# - For other environments: use their own CloudFront distribution from the admin-ui stack
if [ -z "$DISTRIBUTION_ID" ]; then
    # Check if this environment has its own CloudFront distribution
    STACK_CF_ID=$(aws cloudformation describe-stacks --stack-name $STACK_ADMIN_UI --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" --output text --region $REGION 2>/dev/null || echo "")

    if [ -n "$STACK_CF_ID" ] && [ "$STACK_CF_ID" != "None" ]; then
        DISTRIBUTION_ID="$STACK_CF_ID"
        ADMIN_URL=$(aws cloudformation describe-stacks --stack-name $STACK_ADMIN_UI --query "Stacks[0].Outputs[?OutputKey=='CustomDomainURL'].OutputValue" --output text --region $REGION 2>/dev/null || echo "")
        if [ -z "$ADMIN_URL" ] || [ "$ADMIN_URL" = "None" ]; then
            ADMIN_URL=$(aws cloudformation describe-stacks --stack-name $STACK_ADMIN_UI --query "Stacks[0].Outputs[?OutputKey=='CloudFrontURL'].OutputValue" --output text --region $REGION)
        fi
        ADMIN_URL="${ADMIN_URL}/admin/"
    else
        # Fall back to main distribution for prod
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
