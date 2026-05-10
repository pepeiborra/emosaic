# AWS Backend

CloudFormation, Lambdas, and CLI tools for the cloud rendering pipeline + tile-flagging system.

For the cross-component picture see [`../ARCHITECTURE.md`](../ARCHITECTURE.md). For the deployment runbook see [`../DEPLOYMENT.md`](../DEPLOYMENT.md). This file is the inventory.

## Scope

The backend covers:

- Mosaic CRUD + job orchestration (admin UI talks to this)
- AWS Batch container runner that actually executes the Rust binary
- User registration / Cognito user pool
- Image upload (presigned URLs)
- Tile flagging (public-facing report-inappropriate-tile API used by the embedded widget)
- Error logging
- Admin endpoints

Auth: Cognito JWT for mosaic/user/admin endpoints; tile flagging is public + rate-limited.

## Lambda inventory (24 total)

| Area | Lambda | Path |
|------|--------|------|
| Tile flagging (3) | `toggle_flag` | `lambda/toggle_flag.py` |
| | `get_flags` | `lambda/get_flags.py` |
| | `admin_get_all_flags` | `lambda/admin_get_all_flags.py` |
| Mosaic CRUD (5) | `create_mosaic`, `list_mosaics`, `get_mosaic`, `update_mosaic`, `delete_mosaic` | `lambda/mosaic/*.py` |
| | `set_main_mosaic` | `lambda/mosaic/set_main_mosaic.py` |
| Jobs (5) | `submit_job`, `list_jobs`, `get_job`, `cancel_job` | `lambda/mosaic/*.py` |
| | `job_completed` (EventBridge trigger) | `lambda/job_completed.py` |
| User / auth (4) | `registration`, `user_management`, `captcha`, `custom_message` | `lambda/mosaic/*.py` |
| Tiles / uploads (4) | `image_upload`, `get_upload_url`, `get_tile_count`, `list_tile_folders` | `lambda/mosaic/*.py` |
| Errors (2) | `log_error`, `list_errors` | `lambda/mosaic/*.py` |

The mosaic API surface evolves; rather than enumerating endpoints here (they go stale fast), see how the admin UI calls them in `admin-ui/src/` (the API client is the source of truth) and the routes in `cloudformation/mosaic-api.yaml`.

## DynamoDB tables (per environment)

| Table | Purpose |
|-------|---------|
| `${env}-tile-flags` | Reported inappropriate tiles. Partition key `tile_hash`; TTL 30 days; GSI `flagged-at-index` for time-ordered admin scan. |
| `${env}-rate-limits` | Per-IP per-minute counter for tile flagging. Hourly TTL. |
| `${env}-mosaics` | Mosaic metadata, parameters, status, stats. |
| `${env}-mosaic-jobs` | Batch job records linked to mosaics; updated by `job_completed`. |

## CloudFormation stacks

In `cloudformation/`:

| Template | Stack name (parameterised) | Provisions |
|----------|----------------------------|------------|
| `tile-flags-infrastructure.yaml` | `${env}-tile-flags-infrastructure` | DynamoDB (flags + rate-limits), Lambdas, API Gateway. |
| `mosaic-infrastructure.yaml` | `${env}-mosaic-infrastructure` | Mosaics/jobs DynamoDB tables, S3 tiles bucket, Cognito user pool. |
| `job-handler.yaml` | `${env}-job-handler` | EventBridge rule + `job_completed` Lambda. |
| `batch-infrastructure.yaml` | `${env}-batch-infrastructure` | ECR repo, Batch compute environment, job queue, job definition. |
| `mosaic-api.yaml` | `${env}-mosaic-api` | API Gateway routes for mosaic + jobs + uploads + Lambdas. |
| `phase3-enhancements.yaml` | `${env}-phase3-enhancements` | Incremental additions (see `docs/archive/aws-backend/PHASE3_SUMMARY.md`). |
| `user-management.yaml` | `${env}-user-management` | Cognito triggers, user admin Lambdas. |
| `image-upload.yaml` | `${env}-image-upload` | Presigned upload URL Lambda + bucket policy. |
| `domain-certificate.yaml` | `${env}-domain-certificate` | ACM cert (deployed to `us-east-1` regardless of primary region). |
| `admin-ui-infrastructure.yaml` | `${env}-admin-ui` | S3 + CloudFront for the admin UI. |
| `api-gateway.yaml` | (referenced indirectly) | Shared API Gateway primitives. |

## Deploy scripts

| Script | Purpose |
|--------|---------|
| `deploy-cloud.sh` | **Canonical full-stack deploy.** Reads env vars, deploys all stacks in dependency order. See `DEPLOYMENT.md`. |
| `deploy.sh` | **Legacy.** Deploys only the tile-flagging stack. Pre-dates the mosaic API. |
| `deploy-admin-ui.sh` | Build + sync the React app to S3 + invalidate CloudFront. |
| `cleanup-cloud.sh`, `cleanup_and_redeploy.sh` | Teardown / nuke-and-pave helpers. |
| `update-api-endpoint.sh` | Patch `mosaic-widget.js` with the deployed API URL (legacy widget). |
| `test-api.sh`, `test-batch.sh`, `test-phase3.sh` | Smoke tests against a deployed environment. |
| `list-dynamo-tables-parallel.sh` | Diagnostic / bulk listing helper. |

The Docker image build/push lives at the repo root: `../build-and-push.sh`.

VPC auto-detection: `../find-vpc.sh` is invoked by `deploy-cloud.sh` to pick a default VPC + subnets if `VPC_ID`/`SUBNET_IDS` aren't set.

## Environment variables

Used across deploy scripts and Lambdas:

| Variable | Default | Used by |
|----------|---------|---------|
| `ENVIRONMENT` | `prod` | All deploy scripts; prefixes resource names. |
| `AWS_REGION` | `eu-west-3` (cloud) / `us-east-1` (legacy `deploy.sh`) | All deploy scripts. |
| `CORS_ORIGIN` | `https://${env}.casadelmanco.com` (or `https://casadelmanco.com` for prod) | `deploy-cloud.sh`, Lambdas. |
| `ADMIN_EMAIL` | (required for cloud deploy) | `deploy-cloud.sh` — initial Cognito admin user. |
| `VPC_ID`, `SUBNET_IDS` | auto-detected | `deploy-cloud.sh` (Batch compute env). |
| `CUSTOM_DOMAIN`, `ROOT_DOMAIN`, `HOSTED_ZONE_ID` | unset | Optional Route 53 + ACM wiring for a custom subdomain. |
| `USE_EXISTING_RESOURCES`, `EXISTING_TILES_BUCKET` | `true`, `emosaic-tiles-prod` | Reuse existing S3 / IAM where possible. |
| `CLEAN_FIRST` | `false` | If `true`, delete all stacks before deploying. |
| `IMAGE_TAG` | `latest` | `build-and-push.sh`. |

Multi-environment guide: [`ENVIRONMENTS.md`](./ENVIRONMENTS.md).

## CLI tools

### `tile_manager.py`

Manage flagged tiles. Requires `pip install -r requirements.txt`.

```bash
python tile_manager.py list [--limit N] [--next-key TOKEN] [--format table|json]
python tile_manager.py review [--batch-size N]    # interactive: open / unflag / delete / continue / quit
python tile_manager.py delete TILE_HASH ... [--confirm]
```

Global flags: `--environment` (default `prod`), `--region` (default `us-east-1`).

### `user_manager.py`

Cognito user pool admin (create users, reset passwords, list, etc.). Run `python user_manager.py --help` for the current command list.

### `backfill_image_hashes.py`

One-shot migration utility for back-filling content hashes on existing DynamoDB items. Inspect before running — not idempotent in all branches.

## Tile-flagging API quick reference

Base URL is in the API Gateway output of the `tile-flags-infrastructure` stack.

```http
POST   /tiles/{tileHash}/flag       # body: { "tilePath": "..." }
DELETE /tiles/{tileHash}/flag
POST   /tiles/flags                 # body: { "tileHashes": ["...", ...] } — bulk get
GET    /admin/flags?limit=100&lastKey=...
```

Rate limits: 10 RPS / 20 burst at API Gateway; per-IP DynamoDB counter in `toggle_flag` Lambda (10 flags/minute).

CloudWatch log groups: `/aws/lambda/${env}-toggle-tile-flag`, `${env}-get-tile-flags`, `${env}-admin-get-all-flags`.

## Cleanup

```bash
ENVIRONMENT=prod ./cleanup-cloud.sh    # tears down all stacks
```

This removes data — DynamoDB tables and S3 contents go with it.

## Cost

Pay-per-request DynamoDB + on-demand Lambda + on-demand Batch (Fargate) + small S3/CloudFront. With low usage the maintainer's bill sits around $5–6/month; the dominant variable cost is Batch compute when rendering large mosaics.
