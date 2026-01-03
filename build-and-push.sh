#!/bin/bash
# Build and push emosaic Docker image to AWS ECR

set -e

ENVIRONMENT=${ENVIRONMENT:-prod}
REGION=${AWS_REGION:-eu-west-3}
IMAGE_TAG=${IMAGE_TAG:-latest}

echo "🐳 Building and pushing emosaic Docker image"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo "Image Tag: $IMAGE_TAG"
echo ""

# Check Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

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

echo "✅ Prerequisites check passed"

# Run tests
echo ""
echo "🧪 Running tests..."
if ! cargo test --release; then
    echo "❌ Tests failed. Fix the tests before building."
    exit 1
fi

echo "✅ All tests passed"

# Get ECR repository URI from CloudFormation
echo ""
echo "📋 Getting ECR repository URI..."
STACK_NAME="${ENVIRONMENT}-batch-infrastructure"
ECR_URI=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='ECRRepositoryUri'].OutputValue" \
    --output text \
    --region $REGION 2>/dev/null)

if [ -z "$ECR_URI" ]; then
    echo "❌ ECR repository not found. Make sure batch-infrastructure stack is deployed."
    echo "   Deploy with: cd aws-backend && ./deploy-cloud.sh"
    exit 1
fi

echo "ECR Repository: $ECR_URI"

# Get AWS account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

# Login to ECR
echo ""
echo "🔐 Logging in to ECR..."
aws ecr get-login-password --region $REGION | \
    docker login --username AWS --password-stdin $REGISTRY

if [ $? -ne 0 ]; then
    echo "❌ ECR login failed"
    exit 1
fi

echo "✅ Logged in to ECR"

# Build Docker image
echo ""
echo "🏗️  Building Docker image..."
echo "This may take several minutes on first build..."

docker build \
    --platform linux/amd64 \
    -t emosaic:$IMAGE_TAG \
    -t $ECR_URI:$IMAGE_TAG \
    -t $ECR_URI:latest \
    .

if [ $? -ne 0 ]; then
    echo "❌ Docker build failed"
    exit 1
fi

echo "✅ Docker image built successfully"

# Get image size
IMAGE_SIZE=$(docker images emosaic:$IMAGE_TAG --format "{{.Size}}")
echo "Image size: $IMAGE_SIZE"

# Push to ECR
echo ""
echo "📤 Pushing image to ECR..."
docker push $ECR_URI:$IMAGE_TAG

if [ "$IMAGE_TAG" != "latest" ]; then
    echo "Pushing latest tag..."
    docker push $ECR_URI:latest
fi

if [ $? -ne 0 ]; then
    echo "❌ Push to ECR failed"
    exit 1
fi

echo ""
echo "✅ Image pushed successfully!"
echo ""
echo "Image URI: $ECR_URI:$IMAGE_TAG"
echo ""
echo "Next steps:"
echo "1. Update Batch job definition if needed"
echo "2. Test by submitting a job through the API"
echo "3. Monitor job progress in AWS Batch console"
