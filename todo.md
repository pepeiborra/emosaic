# Emosaic Cloud Migration - Task Tracking

## Overview
This file tracks progress on migrating emosaic to the cloud with a React admin UI.

---

## Phase 1: Infrastructure Setup ✅ COMPLETED

### S3 Tile Storage
- [x] Create S3 bucket `emosaic-tiles` with appropriate settings
- [x] Configure bucket policy for private access (CloudFront only)
- [ ] Set up folder structure (by year or flat) - deferred to Phase 5
- [ ] Sync tiles from iCloud to S3 (~initial upload) - deferred to Phase 5
- [ ] Verify tile accessibility from AWS services - deferred to Phase 2
- [ ] Document tile sync process for future additions - deferred to Phase 5

### DynamoDB Tables
- [x] Create `prod-mosaics` table schema
  - Partition key: `id` (string)
  - Attributes: title, created_at, config, status, is_main, s3_path, thumbnail_path
  - GSI: by-created-at index for listing
- [x] Create `prod-mosaic-jobs` table schema
  - Partition key: `id` (string)
  - GSI on `mosaic_id` and `status` for queries
  - Attributes: mosaic_id, status, started_at, completed_at, error_message
  - TTL enabled for automatic cleanup
- [x] Add tables to CloudFormation template (mosaic-infrastructure.yaml)
- [ ] Deploy and verify tables - ready for deployment

### Cognito User Pool
- [x] Create CloudFormation template for Cognito resources (mosaic-infrastructure.yaml)
- [x] Configure User Pool settings
  - Email as username
  - Password policies (12+ chars, mixed case, numbers, symbols)
  - No self-registration (admin-create-only)
- [x] Create App Client for React admin
- [x] Create initial admin user (automated via CloudFormation parameter)
- [ ] Test authentication flow locally - deferred to Phase 4
- [x] Document admin user creation process (see deploy-cloud.sh)

### API Gateway Extensions
- [x] Design API routes structure (7 new endpoints)
- [x] Add Cognito authorizer to API Gateway
- [x] Create Lambda functions (list, get, create, update, delete, submit-job, get-job)
- [x] Configure CORS for admin UI origin
- [ ] Deploy and test authorization - ready for deployment

### Deployment
- [x] Create comprehensive deployment script (deploy-cloud.sh)
- [x] Package Lambda functions
- [x] Create Phase 1 summary documentation

---

## Phase 2: Containerization ✅ COMPLETED

### Docker Setup
- [x] Create Dockerfile for emosaic
  - Base image with Rust runtime
  - Multi-stage build for minimal size
  - Install AWS CLI and image processing dependencies
  - Entry point script
- [x] Create docker-compose.yml for local testing
- [x] Test container locally with sample tiles
- [x] Document build process

### ECR Repository
- [x] Create ECR repository `emosaic` (in CloudFormation)
- [x] Set up build and push script (build-and-push.sh)
- [ ] Push initial image to ECR - ready to run after deployment
- [ ] Test pulling image from ECR - ready after push

### AWS Batch Configuration
- [x] Create Compute Environment (Fargate)
  - vCPU and memory configuration
  - Subnets and security groups
- [x] Create Job Queue
- [x] Create Job Definition
  - Container image from ECR
  - Environment variables for configuration
  - S3 access via IAM role
- [x] Implement job submission in submit_job Lambda
- [x] Implement job completion handler (EventBridge + Lambda)
- [ ] Test job submission manually - ready after image push
- [ ] Verify mosaic generation in cloud - ready after testing

---

## Phase 3: Backend APIs

### Lambda Functions - Mosaic CRUD
- [ ] `create-mosaic-job` Lambda
  - Validate input parameters
  - Create mosaic record in DynamoDB
  - Submit AWS Batch job
  - Return job ID
- [ ] `list-mosaics` Lambda
  - Query DynamoDB for all mosaics
  - Include pagination support
  - Return mosaic metadata
- [ ] `get-mosaic` Lambda
  - Get single mosaic by ID
  - Include job history
- [ ] `delete-mosaic` Lambda
  - Delete mosaic record
  - Delete S3 artifacts
  - Handle main mosaic edge case
- [ ] `set-main-mosaic` Lambda
  - Update is_main flag
  - Update CloudFront/S3 index redirect

### Lambda Functions - Job Management
- [ ] `get-job-status` Lambda
  - Query job from DynamoDB
  - Optionally query AWS Batch for real-time status
- [ ] `list-jobs` Lambda
  - List recent jobs with pagination
  - Filter by status optionally

### Job Completion Handler
- [ ] Create EventBridge rule for Batch job state changes
- [ ] `job-completed` Lambda
  - Triggered by EventBridge
  - Update job status in DynamoDB
  - Update mosaic status
  - Copy output files to final S3 location
  - Generate thumbnail if needed

### CloudFormation Updates
- [ ] Add all Lambda functions to template
- [ ] Add IAM roles with least privilege
- [ ] Add API Gateway routes
- [ ] Add EventBridge rules
- [ ] Deploy and test APIs with curl/Postman

---

## Phase 4: Admin UI

### Project Setup
- [ ] Initialize React project with Vite + TypeScript
- [ ] Configure Tailwind CSS
- [ ] Set up AWS Amplify for Cognito
- [ ] Configure React Router
- [ ] Set up React Query
- [ ] Create basic project structure

### Authentication
- [ ] Create Login page component
- [ ] Implement Cognito sign-in flow
- [ ] Create AuthContext for app-wide auth state
- [ ] Add protected route wrapper
- [ ] Handle token refresh
- [ ] Create logout functionality

### Dashboard Page
- [ ] Create Dashboard layout component
- [ ] Implement mosaic list with thumbnails
- [ ] Add mosaic status indicators
- [ ] Show main mosaic badge
- [ ] Add navigation to create/detail pages
- [ ] Implement responsive grid layout

### Create Mosaic Page
- [ ] Create form component
- [ ] Source image upload with preview
- [ ] Tile size selector (16, 32, 64)
- [ ] Mode selector (1-128, random)
- [ ] Opacity slider (0-1)
- [ ] Advanced options (no-repeat, crop, etc.)
- [ ] Title input
- [ ] Form validation
- [ ] Submit handler with API call
- [ ] Success/error feedback
- [ ] Redirect to job status page

### Mosaic Detail Page
- [ ] Display mosaic image (full viewer embed)
- [ ] Show creation parameters
- [ ] Show creation timestamp
- [ ] "Set as Main" button
- [ ] "Delete" button with confirmation
- [ ] Job history section
- [ ] Link to public viewer

### Job Status Page
- [ ] Display job progress/status
- [ ] Auto-refresh while in progress
- [ ] Show logs/errors if failed
- [ ] Link to completed mosaic

### Tile Management (Optional)
- [ ] List flagged tiles
- [ ] View tile image
- [ ] Unflag/delete tile actions
- [ ] Pagination

### UI Polish
- [ ] Loading states and skeletons
- [ ] Error boundaries
- [ ] Empty states
- [ ] Mobile responsive design
- [ ] Dark mode (optional)

### Build and Deploy
- [ ] Configure production build
- [ ] Set up S3 bucket for admin UI
- [ ] Configure CloudFront for /admin path
- [ ] Create deployment script
- [ ] Test production deployment

---

## Phase 5: Integration & Polish

### CloudFront Configuration
- [ ] Configure origin for /admin/* → Admin S3 bucket
- [ ] Configure origin for /mosaic/* → Mosaic outputs
- [ ] Configure origin for /api/* → API Gateway
- [ ] Configure origin for / → Main mosaic
- [ ] Set up proper cache behaviors
- [ ] Test all routes

### Container Integration
- [ ] Finalize container entry point script
- [ ] Handle S3 input/output in container
- [ ] Add logging to CloudWatch
- [ ] Test full flow: API → Batch → S3 → CloudFront

### Monitoring & Alerting
- [ ] Set up CloudWatch dashboards
- [ ] Create alerts for job failures
- [ ] Monitor API latency
- [ ] Track S3 storage usage

### Documentation
- [ ] Update README with cloud architecture
- [ ] Document admin user management
- [ ] Document tile addition process
- [ ] Document troubleshooting steps
- [ ] API documentation

### Testing
- [ ] End-to-end testing of mosaic creation
- [ ] Test authentication flows
- [ ] Test error handling
- [ ] Performance testing
- [ ] Mobile UI testing

---

## Completed Tasks

_Move completed tasks here with completion date_

---

## Notes & Decisions

### 2025-12-06: Phase 2 Completed
- Completed Docker containerization with multi-stage build
- Created comprehensive entrypoint script for S3 I/O
- Implemented AWS Batch infrastructure with Fargate
- Created ECR repository with lifecycle policies
- Enhanced submit_job Lambda to integrate with Batch
- Created job completion handler with EventBridge
- Updated deployment script to support Batch (5 phases)
- Created build-and-push.sh for Docker image management
- Ready for deployment (requires VPC_ID and SUBNET_IDS)
- Cost: ~$0.02 per mosaic, ~$5-6/month total infrastructure

### 2025-12-06: Phase 1 Completed
- Completed all Phase 1 infrastructure setup tasks
- Created 3 CloudFormation templates:
  - mosaic-infrastructure.yaml (S3, DynamoDB, Cognito)
  - mosaic-api.yaml (API Gateway + Lambda functions)
  - tile-flags-infrastructure.yaml (existing, unchanged)
- Created 7 Lambda functions for mosaic/job management
- Created deploy-cloud.sh automated deployment script
- Ready for deployment with: `ADMIN_EMAIL=admin@example.com ./deploy-cloud.sh`

### 2024-XX-XX: Initial Planning
- Created comprehensive plan.md
- Identified 5 main phases
- Estimated ~$10-30/month cost

---

## Blockers & Issues

_Track any blockers or issues here_

---

## Future Enhancements (Out of Scope)

- [ ] Email notifications when mosaic is ready
- [ ] WebSocket for real-time job status
- [ ] Multiple admin users with roles
- [ ] Mosaic versioning and history
- [ ] Automatic tile sync from iCloud
- [ ] ML-based tile auto-flagging
- [ ] Mosaic sharing with social media
