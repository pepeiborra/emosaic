# Phase 2 Implementation Summary

## Completed Tasks

### 1. Docker Containerization

#### Dockerfile (Multi-Stage Build)
- **Stage 1 (Builder)**: Compiles Rust binary using rust:1.75-slim
  - Installs build dependencies (pkg-config, libssl-dev)
  - Copies source and builds release binary

- **Stage 2 (Runtime)**: Minimal Debian image
  - Runtime dependencies only (ca-certificates, libssl3, curl)
  - AWS CLI v2 for S3 operations
  - Non-root user for security
  - Working directories for tiles, output, and temp files

#### Container Entry Point (`docker/entrypoint.sh`)
Comprehensive script that orchestrates the mosaic generation workflow:
1. **Downloads source image** from S3
2. **Syncs tile directory** from S3
3. **Runs emosaic** with configurable parameters
4. **Uploads output** back to S3 with metadata

Supported parameters:
- `TILE_SIZE`, `MODE`, `TINT_OPACITY`
- `NO_REPEAT`, `CROP`, `RANDOMIZE`
- S3 paths for source, output, and tiles

#### Docker Compose Configuration
Created `docker-compose.yml` for local testing:
- Main service with AWS credential pass-through
- Optional LocalStack service for S3 emulation
- Volume mounts for local testing without AWS

#### Build Optimization
- `.dockerignore` file to exclude unnecessary files
- Multi-stage build minimizes final image size
- Platform specification for AWS compatibility (`linux/amd64`)

### 2. AWS Batch Infrastructure

#### CloudFormation Template: `batch-infrastructure.yaml`

**ECR Repository**:
- Image scanning on push for security
- Lifecycle policy: keep last 10 images
- Named: `{environment}-emosaic`

**IAM Roles** (3):
- **BatchServiceRole**: For AWS Batch service
- **ECSTaskExecutionRole**: For pulling images and logging
- **ECSTaskRole**: For container access to S3 and DynamoDB

**Batch Compute Environment**:
- Type: FARGATE (serverless, no EC2 management)
- Configurable max vCPUs
- VPC and subnet configuration
- Security group with outbound-only access

**Batch Job Queue**:
- Priority-based queue
- Linked to compute environment

**Batch Job Definition**:
- Container configuration: 2 vCPU, 4GB memory
- Environment variables for job parameters
- CloudWatch Logs integration
- Parameterized for dynamic job submission

**EventBridge Integration**:
- Rule to trigger on job state changes (SUCCEEDED/FAILED)
- Targets job completion Lambda

### 3. Job Management System

#### Job Completion Lambda (`job_completed.py`)
Triggered by EventBridge when Batch jobs complete:
- Parses Batch job events
- Updates job status in DynamoDB
- Updates mosaic status (completed/failed)
- Captures error messages and log streams
- Handles job naming convention: `{mosaic_id}_{job_id}`

#### Updated Submit Job Lambda (`submit_job.py`)
Enhanced to actually submit jobs to AWS Batch:
- Retrieves mosaic configuration from DynamoDB
- Validates source image path exists
- Constructs Batch job parameters from mosaic settings
- Submits job to Batch queue
- Updates mosaic status to "processing"
- Tracks Batch job ID for monitoring

#### CloudFormation Template: `job-handler.yaml`
- Job completion Lambda function
- EventBridge rule for Batch state changes
- IAM permissions for Lambda invocation

### 4. Build and Deployment Automation

#### Build Script: `build-and-push.sh`
Automated Docker image build and ECR push:
- Validates Docker and AWS CLI availability
- Retrieves ECR repository URI from CloudFormation
- Authenticates to ECR
- Builds multi-platform image
- Pushes with version tag and `latest`
- Provides next-step guidance

#### Enhanced Deployment Script: `deploy-cloud.sh`
Now deploys 5 phases:
1. Tile flags infrastructure (existing)
2. Mosaic management infrastructure (S3, DynamoDB, Cognito)
3. Job handler (EventBridge + Lambda)
4. **NEW**: Batch infrastructure (ECR + AWS Batch)
5. Mosaic API (API Gateway + Lambda)

Features:
- Optional Batch deployment (requires VPC_ID and SUBNET_IDS)
- Graceful handling of missing VPC configuration
- Comprehensive deployment summary with all resource IDs
- Context-aware next steps based on deployment

## File Structure

```
emosaic/
├── Dockerfile                              (NEW)
├── .dockerignore                           (NEW)
├── docker-compose.yml                      (NEW)
├── build-and-push.sh                       (NEW)
├── docker/
│   └── entrypoint.sh                       (NEW)
└── aws-backend/
    ├── cloudformation/
    │   ├── batch-infrastructure.yaml       (NEW)
    │   ├── job-handler.yaml                (NEW)
    │   └── mosaic-api.yaml                 (UPDATED - added Batch env vars)
    ├── lambda/
    │   ├── job_completed.py                (NEW)
    │   └── mosaic/
    │       └── submit_job.py               (UPDATED - Batch integration)
    └── deploy-cloud.sh                     (UPDATED - added Phases 3-4)
```

## How It Works

### End-to-End Mosaic Generation Flow

1. **User submits job** via API: `POST /jobs` with `mosaic_id`
2. **Submit job Lambda**:
   - Retrieves mosaic configuration from DynamoDB
   - Constructs Batch job parameters
   - Submits job to AWS Batch
   - Updates mosaic status to "processing"
3. **AWS Batch**:
   - Pulls Docker image from ECR
   - Provisions Fargate container (2 vCPU, 4GB RAM)
   - Runs container with environment variables
4. **Container execution** (`entrypoint.sh`):
   - Downloads source image from S3
   - Syncs tiles from S3
   - Runs emosaic binary
   - Uploads HTML output to S3
5. **EventBridge** detects job completion
6. **Job completion Lambda**:
   - Updates job status in DynamoDB
   - Updates mosaic status to "completed" or "failed"
   - Captures logs and error messages

### Deployment Workflow

```bash
# Phase 1 & 2: Deploy infrastructure
cd aws-backend
ADMIN_EMAIL=admin@example.com \
VPC_ID=vpc-xxx \
SUBNET_IDS=subnet-xxx,subnet-yyy \
./deploy-cloud.sh

# Build and push Docker image
cd ..
./build-and-push.sh

# Upload tiles and test images to S3
aws s3 sync ./tiles s3://emosaic-tiles-prod/tiles/
aws s3 cp test-image.jpg s3://emosaic-tiles-prod/test/input.jpg

# Submit test job via API
curl -X POST https://api.example.com/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"mosaic_id": "test-123"}'
```

## Configuration Parameters

### Batch Job Definition Parameters
- `S3_BUCKET`: S3 bucket name
- `SOURCE_IMAGE_KEY`: Path to source image in S3
- `OUTPUT_KEY`: Path for output HTML
- `TILES_PREFIX`: Prefix for tile directory in S3
- `TILE_SIZE`: Tile size (16, 32, 64)
- `MODE`: Analysis mode (1-128, or random)
- `TINT_OPACITY`: Tint overlay opacity (0.0-1.0)
- `NO_REPEAT`: Disable tile repetition (true/false)
- `CROP`: Crop tiles vs resize (true/false)
- `RANDOMIZE`: Randomization factor (0-100)

### VPC Requirements for Batch
AWS Batch with Fargate requires:
- VPC with private subnets
- NAT Gateway for internet access (to pull ECR images)
- Subnets in at least 2 availability zones (recommended)

## Cost Analysis

### Phase 2 Additional Costs

**AWS Batch (Fargate)**:
- Per-second billing: ~$0.04 per vCPU-hour, ~$0.004 per GB-hour
- Example: 2 vCPU, 4GB, 5 min job = ~$0.02 per mosaic

**ECR Storage**:
- $0.10 per GB-month
- Estimated image size: ~500MB = $0.05/month

**EventBridge**:
- First 1M events free

**CloudWatch Logs**:
- $0.50 per GB ingested
- Minimal for batch logs

**Total Additional Monthly Cost** (10 mosaics/month):
- Batch: $0.20
- ECR: $0.05
- Logs: $0.10
- **Total: ~$0.35/month**

Combined Phase 1 + Phase 2: **~$5-6/month**

## Testing

### Local Testing with Docker Compose
```bash
# Set up test data
mkdir -p test-data/{input,tiles,output}
cp sample.jpg test-data/input/source_image.jpg
cp tiles/* test-data/tiles/

# Run with docker-compose
docker-compose up

# Or run with AWS S3
S3_BUCKET=emosaic-tiles-prod \
SOURCE_IMAGE_KEY=test/input.jpg \
docker-compose up
```

### Testing Batch Job Submission
```bash
# Get auth token
TOKEN=$(curl -X POST https://cognito-idp.us-east-1.amazonaws.com/ \
  -H "X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth" \
  -d '{...}' | jq -r '.AuthenticationResult.IdToken')

# Create mosaic
MOSAIC_ID=$(curl -X POST https://api.example.com/mosaics \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Test","source_image_path":"s3://bucket/test.jpg"}' \
  | jq -r '.id')

# Submit job
JOB_ID=$(curl -X POST https://api.example.com/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"mosaic_id\":\"$MOSAIC_ID\"}" \
  | jq -r '.id')

# Check job status
curl https://api.example.com/jobs/$JOB_ID \
  -H "Authorization: Bearer $TOKEN"
```

## Next Steps (Phase 3: Backend APIs)

Phase 2 provides the foundation for serverless mosaic generation. Phase 3 will add:
- Enhanced error handling and retry logic
- Job cancellation endpoints
- Batch job monitoring dashboard
- Pre-signed S3 URLs for file uploads
- Thumbnail generation
- Progress tracking (via step functions)

## Known Limitations

1. **VPC Required**: Batch deployment requires existing VPC infrastructure
2. **Cold Starts**: First Batch job may take ~30s to provision container
3. **No Progress Updates**: Job is either pending, running, or completed (no % progress)
4. **Single Output Format**: Currently only generates HTML output
5. **No Input Validation**: Container trusts all input parameters

## Troubleshooting

### Batch Job Fails
- Check CloudWatch logs: `/aws/batch/prod-emosaic`
- Verify S3 paths are correct and accessible
- Ensure tiles exist in S3 bucket
- Check container exit code in job details

### ECR Push Fails
- Re-authenticate: `aws ecr get-login-password | docker login ...`
- Check IAM permissions for ECR
- Verify image size is under ECR limits

### Container Build Fails
- Ensure Rust toolchain matches rust-toolchain.toml
- Check dependencies are available in Debian repos
- Verify source files are not excluded by .dockerignore
