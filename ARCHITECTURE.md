# Architecture

A high-level map of how the four emosaic components fit together. Read this before changing anything that crosses component boundaries.

## Components

1. **Rust generator** (`src/`, binary `emosaic`)
   The mosaic engine. CPU- and memory-heavy, parallelised with `rayon`, k-d trees via `kiddo`. Runs identically locally and inside the AWS Batch container — there is no AWS-aware code in the binary itself.

2. **Container runner** (`Dockerfile`, `docker/entrypoint.sh`, `build-and-push.sh`)
   Multi-stage build that compiles the binary with nightly Rust and ships a `debian:bookworm-slim` runtime image (with AWS CLI + ImageMagick). Pushed to ECR; consumed by AWS Batch.

3. **AWS backend** (`aws-backend/`)
   - **API Gateway**: REST APIs (Cognito-authenticated for admin/user endpoints; public + rate-limited for tile-flagging).
   - **24 Lambdas** (Python): mosaic CRUD, job orchestration, user/registration, image upload, tile flagging, error logging, EventBridge job-completion handler.
   - **AWS Batch**: runs the container on Fargate-ish compute, fed by `submit_job` Lambda.
   - **DynamoDB**: 4 tables (see below).
   - **S3**: tile library, source images, mosaic outputs, admin-UI hosting.
   - **Cognito**: user pool fronting the admin API.
   - **CloudFront**: serves the admin UI and rendered mosaic HTML; invalidated on job completion.
   - **EventBridge**: Batch job state-change events fan out to `job_completed` Lambda.
   - **ACM**: TLS certs in `us-east-1` for the CloudFront-fronted custom domains.

4. **Admin UI** (`admin-ui/`)
   React 19 + Vite + Tailwind + AWS Amplify (Cognito auth) + TanStack Query + React Router 7. Built to static assets, deployed to S3, served via CloudFront.

## End-to-end mosaic generation flow

```
┌─────────────┐   POST /jobs    ┌──────────────┐   SubmitJob   ┌────────────┐
│  Admin UI   │ ──────────────→ │ API Gateway  │ ────────────→ │ submit_job │
│ (CloudFront)│   (Cognito JWT) │              │               │  (Lambda)  │
└─────────────┘                 └──────────────┘               └─────┬──────┘
                                                                     │
                                                       boto3 batch.submit_job
                                                                     ▼
                                                              ┌────────────┐
                                                              │ AWS Batch  │
                                                              │ job queue  │
                                                              └─────┬──────┘
                                                                    │
                                                          runs ECR image
                                                                    ▼
                                              ┌──────────────────────────────┐
                                              │ Container (entrypoint.sh)    │
                                              │  • aws s3 sync tiles → /app  │
                                              │  • emosaic <input> mosaic …  │
                                              │  • aws s3 cp output → S3     │
                                              └──────────────┬───────────────┘
                                                             │
                                                EventBridge: Batch state change
                                                             ▼
                                                    ┌─────────────────┐
                                                    │ job_completed   │
                                                    │   (Lambda)      │
                                                    │ • read stats from S3
                                                    │ • update DynamoDB
                                                    │ • invalidate CloudFront
                                                    └─────────────────┘
```

Source files to follow when reasoning about this flow:
- `aws-backend/lambda/mosaic/submit_job.py` — entry point, validates the mosaic record, calls `batch.submit_job`.
- `docker/entrypoint.sh` — what the Batch container actually executes.
- `aws-backend/lambda/job_completed.py` — fetches `mosaics/<id>/mosaic.stats.json` (or `error.json`) from S3, writes back to DynamoDB, optionally invalidates CloudFront via `CLOUDFRONT_DISTRIBUTION_ID`.

## Data stores

There is **no relational database**. All persistent state lives in DynamoDB and S3.

| Table (per env) | Purpose |
|------------------|---------|
| `${env}-tile-flags` | User-reported inappropriate tiles. Public flag/unflag API + admin pagination API. 30-day TTL. |
| `${env}-rate-limits` | IP+minute counter for tile-flagging rate limiting. Hourly TTL. |
| `${env}-mosaics` | Mosaic metadata (owner, parameters, status, stats). |
| `${env}-mosaic-jobs` | Batch job records linked to a mosaic; updated by `job_completed`. |

S3 buckets:

| Bucket | Purpose |
|--------|---------|
| `emosaic-tiles-${env}` | Tile library (read by the container) and per-mosaic outputs at `mosaics/<mosaic_id>/`. |
| `casadelmanco.com` (and per-env equivalents) | Static hosting bucket for the public mosaic site (the Makefile `make deploy` flow uploads here). |
| Admin UI bucket | Output of `admin-ui` build (deployed by `aws-backend/deploy-admin-ui.sh`). |

Cognito user pool: `${env}-emosaic-admin-pool`. Admin/user endpoints on the API require a Cognito JWT.

## Auth

| Endpoint area | Auth |
|---------------|------|
| Tile flagging (`/tiles/...`) | Public, rate-limited (10 RPS baseline / 20 burst at API Gateway; per-IP DynamoDB counters in Lambda). |
| Admin flag listing (`/admin/flags`) | Currently public — see "Next Steps" in `aws-backend/README.md`. Treat as not-yet-secured. |
| Mosaic API (`/mosaics`, `/jobs`, `/uploads`, etc.) | Cognito user pool authoriser. |
| Registration / captcha | Public, with captcha gating (`captcha.py`). |

## Environments

`prod`, `rc`, and ad-hoc (`staging`, etc.) — selected by the `ENVIRONMENT` env var; resources are name-prefixed accordingly. Detailed parameter matrix in [`aws-backend/ENVIRONMENTS.md`](./aws-backend/ENVIRONMENTS.md).

## Cross-region notes

- Primary region: `eu-west-3` (default in `deploy-cloud.sh`, `build-and-push.sh`).
- Tile-flagging legacy `deploy.sh` defaults to `us-east-1`.
- ACM certificates for CloudFront (admin UI custom domain) **must** be in `us-east-1` — the `domain-certificate.yaml` stack is deployed to that region by `deploy-cloud.sh` regardless of the primary region.

## CloudFormation stack inventory

Deployed in order by `aws-backend/deploy-cloud.sh`:

| Stack | Template | Purpose |
|-------|----------|---------|
| `${env}-tile-flags-infrastructure` | `tile-flags-infrastructure.yaml` | DynamoDB tables + Lambda + API Gateway for tile flagging. |
| `${env}-mosaic-infrastructure` | `mosaic-infrastructure.yaml` | Mosaic/jobs DynamoDB tables, Cognito, S3. |
| `${env}-job-handler` | `job-handler.yaml` | EventBridge rule + `job_completed` Lambda. |
| `${env}-batch-infrastructure` | `batch-infrastructure.yaml` | ECR repo, compute environment, job queue, job definition. |
| `${env}-mosaic-api` | `mosaic-api.yaml` | API Gateway routes for mosaic CRUD/jobs + Lambdas. |
| `${env}-phase3-enhancements` | `phase3-enhancements.yaml` | Incremental additions on top of the above (see `docs/archive/aws-backend/PHASE3_SUMMARY.md` for the historical context). |
| `${env}-user-management` | `user-management.yaml` | Cognito triggers, custom message, user admin Lambdas. |
| `${env}-image-upload` | `image-upload.yaml` | Pre-signed upload URL Lambda. |
| `${env}-domain-certificate` | `domain-certificate.yaml` | ACM cert in us-east-1 (only when a custom domain is configured). |
| `${env}-admin-ui` | `admin-ui-infrastructure.yaml` | S3 bucket + CloudFront for the admin UI. |

A separate `api-gateway.yaml` is referenced indirectly. See the deploy script for the canonical order.
