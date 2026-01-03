#!/bin/bash

# Deploy script for Emosaic Admin UI
# Prerequisites:
# - AWS CLI configured with appropriate credentials
# - Node.js and npm installed
# - Admin infrastructure deployed (run ../deploy-cloud.sh first)

set -e

# Configuration
ENVIRONMENT="${ENVIRONMENT:-prod}"
AWS_REGION="${AWS_REGION:-eu-west-3}"
STACK_NAME="${ENVIRONMENT}-emosaic-admin-ui"
TEMPLATE_FILE="../aws-backend/cloudformation/admin-ui-infrastructure.yaml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Emosaic Admin UI Deployment Script${NC}"
echo "Environment: $ENVIRONMENT"
echo "Region: $AWS_REGION"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found. Please install it first.${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found. Please install Node.js first.${NC}"
    exit 1
fi

# Get API Gateway URL and Cognito details from CloudFormation outputs
echo -e "${YELLOW}Fetching backend configuration...${NC}"

API_GATEWAY_URL=$(aws cloudformation describe-stacks \
    --stack-name "${ENVIRONMENT}-tile-flags-api" \
    --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
    --output text \
    --region "$AWS_REGION" 2>/dev/null || echo "")

USER_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name "${ENVIRONMENT}-emosaic-infrastructure" \
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
    --output text \
    --region "$AWS_REGION" 2>/dev/null || echo "")

USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks \
    --stack-name "${ENVIRONMENT}-emosaic-infrastructure" \
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" \
    --output text \
    --region "$AWS_REGION" 2>/dev/null || echo "")

if [ -z "$API_GATEWAY_URL" ] || [ -z "$USER_POOL_ID" ] || [ -z "$USER_POOL_CLIENT_ID" ]; then
    echo -e "${RED}❌ Could not fetch backend configuration. Make sure the backend is deployed first.${NC}"
    echo "Run: cd ../aws-backend && ./deploy-cloud.sh"
    exit 1
fi

echo "API Gateway URL: $API_GATEWAY_URL"
echo "User Pool ID: $USER_POOL_ID"
echo ""

# Create .env.production file
echo -e "${YELLOW}Creating .env.production file...${NC}"
cat > .env.production << EOF
VITE_API_URL=${API_GATEWAY_URL}
VITE_USER_POOL_ID=${USER_POOL_ID}
VITE_USER_POOL_CLIENT_ID=${USER_POOL_CLIENT_ID}
VITE_AWS_REGION=${AWS_REGION}
EOF

# Build the application
echo -e "${YELLOW}Building the application...${NC}"
npm run build

# Deploy S3 bucket infrastructure
echo -e "${YELLOW}Deploying S3 infrastructure...${NC}"
aws cloudformation deploy \
    --template-file "$TEMPLATE_FILE" \
    --stack-name "$STACK_NAME" \
    --parameter-overrides Environment="$ENVIRONMENT" \
    --capabilities CAPABILITY_IAM \
    --region "$AWS_REGION"

# Get bucket name and CloudFront distribution ID
BUCKET_NAME=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
    --output text \
    --region "$AWS_REGION")

CLOUDFRONT_ID=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
    --output text \
    --region "$AWS_REGION")

CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontURL'].OutputValue" \
    --output text \
    --region "$AWS_REGION")

# Upload files to S3
echo -e "${YELLOW}Uploading files to S3...${NC}"
aws s3 sync dist/ "s3://$BUCKET_NAME/" \
    --delete \
    --cache-control "public, max-age=31536000" \
    --exclude "index.html" \
    --region "$AWS_REGION"

# Upload index.html with no-cache headers (for updates)
aws s3 cp dist/index.html "s3://$BUCKET_NAME/index.html" \
    --cache-control "no-cache, no-store, must-revalidate" \
    --content-type "text/html" \
    --region "$AWS_REGION"

# Invalidate CloudFront cache
echo -e "${YELLOW}Invalidating CloudFront cache...${NC}"
aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_ID" \
    --paths "/*" \
    --region "$AWS_REGION" > /dev/null

echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo "Access your admin UI at:"
echo -e "${GREEN}$CLOUDFRONT_URL${NC}"
echo ""
echo "S3 Website URL: http://$BUCKET_NAME.s3-website-$AWS_REGION.amazonaws.com"
echo ""
echo "To create an admin user, run:"
echo "aws cognito-idp admin-create-user \\"
echo "    --user-pool-id $USER_POOL_ID \\"
echo "    --username admin@example.com \\"
echo "    --user-attributes Name=email,Value=admin@example.com \\"
echo "    --temporary-password 'TempPassword123!' \\"
echo "    --region $AWS_REGION"