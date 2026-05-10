# Cloud Migration Plan for Emosaic

## Executive Summary

This document outlines the plan to migrate the emosaic mosaic generator to the cloud, creating a React-based admin UI for managing mosaics, with user authentication and a public viewer for the generated mosaics.

## Current Architecture

### Existing Components
1. **Rust CLI Binary** (`emosaic`): Generates photo mosaics from source images and tile collections
2. **Local Makefile Workflow**: Orchestrates generation and S3 upload
3. **AWS Backend** (already exists):
   - DynamoDB tables for tile flagging and rate limiting
   - Lambda functions for flag management
   - API Gateway with CORS support
   - CloudFront distribution for static hosting
4. **Static HTML Output**: Interactive mosaic viewer with tile tooltips, flagging support
5. **Tile Images**: Currently stored in iCloud Drive (`/Users/pepe/Library/Mobile Documents/com~apple~CloudDocs/Fotos campo`)
6. **S3 Bucket**: `casadelmanco.com` with CloudFront distribution `E2KW8FQIKWXD1D`

### Current Workflow
```
Local Machine → cargo run → Generate mosaic → S3 upload → CloudFront
```

## Target Architecture

### High-Level Architecture
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CloudFront                                      │
│                         (casadelmanco.com)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  /           → S3: Main mosaic viewer (widget.html)                         │
│  /mosaic/*   → S3: Individual mosaic viewers                                │
│  /admin/*    → S3: React Admin SPA                                          │
│  /api/*      → API Gateway: Backend APIs                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API Gateway                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  /api/auth/*     → Cognito User Pool                                        │
│  /api/mosaics/*  → Lambda: Mosaic CRUD operations                           │
│  /api/jobs/*     → Lambda: Job status and management                        │
│  /api/tiles/*    → Lambda: Tile flagging (existing)                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Backend Services                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  AWS Batch / ECS Fargate  → Rust binary execution                           │
│  DynamoDB                 → Mosaic metadata, jobs, flags                    │
│  S3                       → Tile storage, mosaic outputs                    │
│  Cognito                  → User authentication                             │
│  SQS                      → Job queue                                        │
│  EventBridge              → Job scheduling and status updates               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Components to Build

#### 1. Tile Storage Migration
- **Goal**: Move tiles from iCloud to S3 for cloud access
- **Approach**:
  - Create S3 bucket `emosaic-tiles` for tile storage
  - Sync existing tiles from iCloud to S3
  - Organize tiles by year/folder structure
  - Set up S3 lifecycle policies for cost optimization

#### 2. Containerized Mosaic Generator
- **Goal**: Run the Rust binary in the cloud
- **Approach**:
  - Create Docker container with the emosaic binary
  - Use AWS Batch with Fargate for on-demand execution
  - Container pulls tiles from S3, generates mosaic, uploads results
  - Support for passing all CLI parameters via environment variables

#### 3. Backend API (Lambda + API Gateway)
- **New Endpoints**:
  - `POST /api/mosaics` - Create new mosaic job
  - `GET /api/mosaics` - List all mosaics
  - `GET /api/mosaics/{id}` - Get mosaic details
  - `DELETE /api/mosaics/{id}` - Delete mosaic
  - `PUT /api/mosaics/{id}/main` - Set as main mosaic
  - `GET /api/jobs/{id}` - Get job status
  - `GET /api/jobs` - List recent jobs
- **DynamoDB Tables**:
  - `mosaics` - Mosaic metadata (id, title, created_at, config, status, is_main, path)
  - `jobs` - Job tracking (id, mosaic_id, status, started_at, completed_at, logs)

#### 4. Authentication System
- **AWS Cognito User Pool**:
  - Email-based authentication
  - Admin users only (no self-registration)
  - JWT tokens for API authorization
- **API Gateway Authorizer**:
  - Cognito authorizer for `/api/*` endpoints
  - Public access to `/mosaic/*` and `/` paths

#### 5. React Admin UI
- **Location**: Served from `/admin` path
- **Features**:
  - Login page with Cognito authentication
  - Dashboard showing all mosaics with thumbnails
  - Create new mosaic form:
    - Source image upload
    - Tile size, mode, opacity settings
    - Preview and submit
  - Mosaic detail view:
    - View generated mosaic
    - See creation parameters and timestamp
    - Set as main mosaic
    - Delete mosaic
  - Job status monitoring
  - Tile management (view flagged tiles, delete)
- **Tech Stack**:
  - React 18 with TypeScript
  - Tailwind CSS for styling
  - AWS Amplify for Cognito integration
  - React Query for data fetching
  - React Router for navigation

#### 6. Public Mosaic Viewer
- **Keep existing viewer**: The current HTML widget works well
- **URL Structure**:
  - `/` - Main mosaic (symlink or redirect to current main)
  - `/mosaic/{id}` - Individual mosaic viewer
- **Enhancements**:
  - Add navigation to browse other mosaics (optional)
  - Keep tile flagging functionality

## Infrastructure Changes

### CloudFormation/SAM Templates

#### New Resources Required:
1. **S3 Buckets**:
   - `emosaic-tiles` - Tile image storage
   - Update `casadelmanco.com` bucket for new path structure

2. **DynamoDB Tables**:
   - `prod-mosaics` - Mosaic metadata
   - `prod-mosaic-jobs` - Job tracking

3. **Cognito**:
   - User Pool with email sign-in
   - App Client for React admin
   - Admin user creation

4. **Lambda Functions**:
   - `create-mosaic-job` - Queue new mosaic generation
   - `get-mosaics` - List/get mosaic metadata
   - `delete-mosaic` - Remove mosaic and artifacts
   - `set-main-mosaic` - Update main mosaic
   - `get-job-status` - Check job progress

5. **AWS Batch**:
   - Compute environment (Fargate)
   - Job queue
   - Job definition with emosaic container

6. **ECR**:
   - Repository for emosaic Docker image

7. **API Gateway**:
   - New routes for mosaic management
   - Cognito authorizer

### CloudFront Configuration
- Origin for `/admin/*` → S3 admin bucket
- Origin for `/mosaic/*` → S3 mosaic outputs
- Origin for `/api/*` → API Gateway
- Origin for `/` → S3 main mosaic

## Security Considerations

1. **Authentication**:
   - All `/api/*` endpoints require Cognito JWT
   - Admin UI requires login
   - Public mosaic viewing is unauthenticated

2. **Authorization**:
   - Only authenticated users can create/delete mosaics
   - Rate limiting on API endpoints
   - S3 bucket policies restrict direct access

3. **Data Protection**:
   - Tiles and mosaics stored in private S3 buckets
   - CloudFront signed URLs for tile access (optional)
   - HTTPS everywhere

## Cost Considerations

1. **Compute**:
   - AWS Batch Fargate: ~$0.04/vCPU-hour, ~$0.004/GB-hour
   - Mosaic generation: ~5-10 minutes = ~$0.02-0.05 per mosaic

2. **Storage**:
   - S3 tiles: ~10GB = ~$0.23/month
   - S3 mosaics: ~100MB per mosaic
   - DynamoDB: On-demand, minimal cost

3. **Data Transfer**:
   - CloudFront to users: Standard rates
   - Within AWS: Minimal

4. **Estimated Monthly Cost**: $10-30 depending on usage

## Implementation Phases

### Phase 1: Infrastructure Setup
- Set up S3 tile bucket and sync tiles
- Create DynamoDB tables
- Set up Cognito user pool
- Extend API Gateway

### Phase 2: Containerization
- Create Dockerfile for emosaic
- Set up ECR repository
- Configure AWS Batch
- Test container execution

### Phase 3: Backend APIs
- Implement Lambda functions for mosaic CRUD
- Implement job queue integration
- Test end-to-end mosaic generation

### Phase 4: Admin UI
- Create React application
- Implement Cognito authentication
- Build mosaic management UI
- Deploy to S3/CloudFront

### Phase 5: Integration & Polish
- Configure CloudFront routing
- Set up monitoring and alerts
- Documentation
- User acceptance testing

## Rollback Plan

1. Keep existing Makefile workflow functional
2. New system runs in parallel initially
3. Switch over only when validated
4. Old S3 content preserved during transition

## Open Questions

1. **Tile Sync Strategy**:
   - One-time sync or continuous sync from iCloud?
   - How to add new tiles going forward?

2. **Job Notifications**:
   - Email notification when mosaic is ready?
   - WebSocket for real-time status?

3. **Access Control**:
   - Single admin user or multiple?
   - Different permission levels?

4. **Mosaic Versioning**:
   - Keep history of mosaic regenerations?
   - Ability to revert to previous version?
