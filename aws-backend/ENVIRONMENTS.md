# Multi-Environment Deployment Guide

This guide explains how to deploy and manage multiple environments (prod, rc, staging, etc.) for the Emosaic cloud infrastructure.

## Overview

All resources are parameterized via the `ENVIRONMENT` variable. Setting this variable automatically prefixes all resources with the environment name:

| Resource Type | Naming Pattern | Example (rc) |
|---------------|----------------|--------------|
| CloudFormation Stacks | `${ENVIRONMENT}-*` | `rc-mosaic-infrastructure` |
| DynamoDB Tables | `${ENVIRONMENT}-*` | `rc-mosaics`, `rc-mosaic-jobs` |
| S3 Buckets | `emosaic-tiles-${ENVIRONMENT}` | `emosaic-tiles-rc` |
| Lambda Functions | `${ENVIRONMENT}-*` | `rc-list-mosaics` |
| Cognito User Pool | `${ENVIRONMENT}-emosaic-admin-pool` | `rc-emosaic-admin-pool` |
| ECR Repository | `${ENVIRONMENT}-emosaic` | `rc-emosaic` |

## Deploying an RC Environment

### With Custom Domain (rc.casadelmanco.com)

To deploy with a custom subdomain, you need your Route 53 Hosted Zone ID:

```bash
# First, get your Hosted Zone ID
aws route53 list-hosted-zones --query "HostedZones[?Name=='casadelmanco.com.'].Id" --output text
# Returns something like: /hostedzone/Z1234567890ABC
# Use just the ID part: Z1234567890ABC
```

Then deploy:

```bash
ENVIRONMENT=rc \
  AWS_REGION=eu-west-3 \
  CORS_ORIGIN="https://rc.casadelmanco.com" \
  ADMIN_EMAIL="admin@example.com" \
  USE_EXISTING_RESOURCES=true \
  EXISTING_TILES_BUCKET=emosaic-tiles-prod \
  CUSTOM_DOMAIN="rc.casadelmanco.com" \
  HOSTED_ZONE_ID="Z1234567890ABC" \
  ./deploy-cloud.sh
```

This will:
1. Create an ACM certificate in us-east-1 (required for CloudFront)
2. Create a CloudFront distribution with the custom domain
3. Add a Route 53 DNS record pointing to CloudFront
4. The Admin UI will be accessible at https://rc.casadelmanco.com

### With Shared Tiles Bucket (No Custom Domain)

To avoid duplicating tile images, RC can share the prod tiles bucket:

```bash
ENVIRONMENT=rc \
  AWS_REGION=eu-west-3 \
  CORS_ORIGIN="https://rc.casadelmanco.com" \
  ADMIN_EMAIL="admin@example.com" \
  USE_EXISTING_RESOURCES=true \
  EXISTING_TILES_BUCKET=emosaic-tiles-prod \
  ./deploy-cloud.sh
```

### With Separate Tiles Bucket

To create a completely isolated environment:

```bash
ENVIRONMENT=rc \
  AWS_REGION=eu-west-3 \
  CORS_ORIGIN="https://rc.casadelmanco.com" \
  ADMIN_EMAIL="admin@example.com" \
  ./deploy-cloud.sh
```

This creates a new `emosaic-tiles-rc` bucket that you'll need to populate with tiles.

## Environment Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `ENVIRONMENT` | Environment name (prod, rc, staging, etc.) | `prod` |
| `AWS_REGION` | AWS region for deployment | `eu-west-3` |
| `CORS_ORIGIN` | Allowed CORS origin for API | `https://casadelmanco.com` |
| `ADMIN_EMAIL` | Email for initial Cognito admin user | (required) |
| `VPC_ID` | VPC ID for Batch compute | (auto-detected) |
| `SUBNET_IDS` | Comma-separated subnet IDs | (auto-detected) |
| `USE_EXISTING_RESOURCES` | Use existing S3 bucket and ECR | `true` |
| `EXISTING_TILES_BUCKET` | Name of existing tiles bucket | `emosaic-tiles-prod` |
| `CLEAN_FIRST` | Delete stacks before deploying | `false` |
| `CUSTOM_DOMAIN` | Custom domain for Admin UI (e.g., rc.casadelmanco.com) | (empty) |
| `ROOT_DOMAIN` | Root domain for certificate | `casadelmanco.com` |
| `HOSTED_ZONE_ID` | Route 53 Hosted Zone ID | (required if CUSTOM_DOMAIN set) |

## Verifying Deployment

After deployment, verify the resources were created:

```bash
# List all stacks for the environment
aws cloudformation list-stacks --query "StackSummaries[?starts_with(StackName, 'rc-')]" --region eu-west-3

# Get API endpoint
aws cloudformation describe-stacks --stack-name rc-tile-flags-infrastructure \
  --query "Stacks[0].Outputs[?OutputKey=='APIGatewayURL'].OutputValue" --output text --region eu-west-3

# Get Cognito User Pool ID
aws cloudformation describe-stacks --stack-name rc-mosaic-infrastructure \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text --region eu-west-3
```

## Cleanup

To delete an RC environment:

```bash
ENVIRONMENT=rc ./cleanup-cloud.sh
```

Or delete stacks manually in reverse dependency order:

```bash
REGION=eu-west-3
aws cloudformation delete-stack --stack-name rc-admin-ui --region $REGION
aws cloudformation delete-stack --stack-name rc-phase3-enhancements --region $REGION
aws cloudformation delete-stack --stack-name rc-mosaic-api --region $REGION
aws cloudformation delete-stack --stack-name rc-batch-infrastructure --region $REGION
aws cloudformation delete-stack --stack-name rc-job-handler --region $REGION
aws cloudformation delete-stack --stack-name rc-mosaic-infrastructure --region $REGION
aws cloudformation delete-stack --stack-name rc-tile-flags-infrastructure --region $REGION

# If custom domain was used, also delete the certificate stack (in us-east-1)
aws cloudformation delete-stack --stack-name rc-domain-certificate --region us-east-1
```

## Notes

- Each environment has its own Cognito User Pool - users must be created separately per environment
- When using `USE_EXISTING_RESOURCES=true`, the tiles bucket must already exist and be accessible
- The ECR repository can also be shared when `USE_EXISTING_RESOURCES=true`
