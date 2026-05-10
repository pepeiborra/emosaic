# Emosaic Cloud Deployment Guide

For the cross-component picture see [`ARCHITECTURE.md`](./ARCHITECTURE.md). For backend internals (Lambda inventory, stacks, env vars) see [`aws-backend/README.md`](./aws-backend/README.md).

## Pre-Deployment Checklist

- [ ] AWS CLI installed (`aws --version`)
- [ ] AWS credentials configured (`aws configure` or `aws sso login`)
- [ ] Docker installed (for building container image)
- [ ] Admin email address ready (for Cognito user)

## Deployment Steps

### Full Deployment

Deploy the complete infrastructure including AWS Batch:

```bash
cd aws-backend
ADMIN_EMAIL=your@email.com ./deploy-cloud.sh
```

The script will automatically detect your default VPC and subnets. If you need to use a specific VPC, you can override:

```bash
ADMIN_EMAIL=your@email.com \
VPC_ID=vpc-xxxxx \
SUBNET_IDS=subnet-aaa,subnet-bbb \
./deploy-cloud.sh
```

This will deploy:
- ✅ S3 bucket for tiles
- ✅ DynamoDB tables (mosaics, jobs)
- ✅ Cognito User Pool
- ✅ API Gateway with all endpoints
- ✅ Lambda functions (24 total: 3 tile-flagging, 20 mosaic API, 1 EventBridge job-completion handler)
- ✅ EventBridge rules
- ✅ AWS Batch (ECR, compute environment, job queue)

**Time**: ~15-20 minutes

### Build and Push Docker Image

After deployment, build and push the container image:

```bash
# from the repo root
./build-and-push.sh
```

This script (at the repo root) runs `cargo test --release` first, then builds the multi-stage Dockerfile (forced to `linux/amd64`), and pushes to the ECR repo created by the `${ENVIRONMENT}-batch-infrastructure` stack.

Env vars: `ENVIRONMENT` (default `prod`), `AWS_REGION` (default `eu-west-3`), `IMAGE_TAG` (default `latest`).

**Time**: ~10-15 minutes (first build), ~2-3 minutes (subsequent)

### Upload Tiles and Test

```bash
# Upload tiles to S3
aws s3 sync /path/to/tiles s3://emosaic-tiles-prod/tiles/

# Upload test source image
aws s3 cp test-image.jpg s3://emosaic-tiles-prod/uploads/test.jpg

# Get auth token (follow Cognito instructions)
# Check email for temporary password

# Test API endpoint
curl https://<api-url>/mosaics \
  -H "Authorization: Bearer $TOKEN"
```

## Environment Variables

### Required
- `ADMIN_EMAIL` - Email for initial admin user

### Optional
- `ENVIRONMENT` - Environment name (default: `prod`)
- `AWS_REGION` - AWS region (default: `eu-west-3`)
- `CORS_ORIGIN` - CORS origin (default: `https://casadelmanco.com`)
- `VPC_ID` - VPC ID for Batch (auto-detected from default VPC if not set)
- `SUBNET_IDS` - Comma-separated subnet IDs for Batch (auto-detected if not set)

## Deployment Outputs

After deployment, you'll get:
- API Gateway URL
- S3 Bucket name
- Cognito User Pool ID
- Cognito Client ID
- ECR Repository URI
- Batch Job Queue name

## Troubleshooting

### "Unable to locate credentials"
Run `aws configure` and enter your AWS credentials.

### "No default VPC found"
The script auto-detects your default VPC. If you don't have a default VPC, set `VPC_ID` and `SUBNET_IDS` manually:
```bash
VPC_ID=vpc-xxxxx SUBNET_IDS=subnet-aaa,subnet-bbb ADMIN_EMAIL=... ./deploy-cloud.sh
```

### "Stack already exists"
The deployment script uses `aws cloudformation deploy` which updates existing stacks.
To start fresh, delete stacks first:
```bash
aws cloudformation delete-stack --stack-name prod-tile-flags-infrastructure
# ... delete other stacks
```

### Docker build fails
Ensure you're in the project root directory and Dockerfile exists.

### Lambda function updates fail
Functions may be in use. Wait a minute and run deployment again.

## Next Steps After Deployment

1. **Check Email**: Get Cognito temporary password
2. **Test Authentication**: Log in via Cognito
3. **Upload Tiles**: Sync tiles to S3
4. **Test Mosaic Generation**: Submit a test job
5. **Build Admin UI**: React application

## Cost Monitoring

After deployment, check AWS Cost Explorer for actual costs.
Expected: ~$5-6/month for low usage.

## Rollback

To remove all infrastructure:
```bash
cd aws-backend

# Delete in reverse order
aws cloudformation delete-stack --stack-name prod-phase3-enhancements
aws cloudformation delete-stack --stack-name prod-mosaic-api
aws cloudformation delete-stack --stack-name prod-batch-infrastructure
aws cloudformation delete-stack --stack-name prod-job-handler
aws cloudformation delete-stack --stack-name prod-mosaic-infrastructure
aws cloudformation delete-stack --stack-name prod-tile-flags-infrastructure
```

**Warning**: This will delete all data including DynamoDB tables and S3 bucket contents.
