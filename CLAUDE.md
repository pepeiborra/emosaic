# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Project Overview

emosaic spans four components:

1. **Rust mosaic generator** (`src/`, binary `emosaic`) — the core engine. Builds locally with nightly Rust, runs identically in the AWS Batch container.
2. **Container** (`Dockerfile`, `docker/`, `build-and-push.sh`) — multi-stage build that pushes the binary to ECR.
3. **AWS backend** (`aws-backend/`) — 24 Python Lambdas, 4 DynamoDB tables, API Gateway, Cognito, AWS Batch, EventBridge, CloudFront. Covers mosaic CRUD, job orchestration, tile flagging, user registration.
4. **Admin UI** (`admin-ui/`) — React 19 + Vite + Tailwind + Amplify (Cognito), deployed to S3/CloudFront.

The deployed instance is **casadelmanco.com**. See `ARCHITECTURE.md` at the repo root for the cross-component picture.

# Build and Development Commands

## Building
```bash
cargo build --release          # Production build (binary at target/release/emosaic)
cargo build                    # Debug build
```

## Testing
```bash
cargo test                     # Run all tests
cargo test <test_name>         # Run specific test
cargo test --release           # Run tests in release mode (faster for heavy tests)
```

The test suite includes:
- Unit tests in individual modules (algorithms.rs, analysis.rs, etc.)
- Integration tests in src/mosaic/mod.rs that verify tile set consistency and rendering correctness
- Property-based tests that verify exact matching for black/white tile universes

## Running
```bash
cargo run --release -- [OPTIONS] <IMG> mosaic <TILES_DIR>
```

Example:
```bash
cargo run --release -- input.jpg mosaic /path/to/tiles --mode 32 --tile-size 32 --tint-opacity 0.5
```

## Makefile Workflow
The Makefile automates mosaic generation and AWS S3 deployment:
```bash
make generate FILE=photo.jpeg TILE_SIZE=32    # Generate mosaic only
make upload FILE=photo.jpeg                   # Generate and upload to S3
make deploy FILE=photo.jpeg                   # Upload and update CloudFront index
```

Key Makefile variables: FILE, TILE_SIZE, MODE, OPACITY, CROP, MORE, TILES_DIR, S3_BUCKET, TITLE

# Code Architecture

## Core Mosaic Engine (src/mosaic/)

### Analysis Pipeline
- **analysis.rs**: Core analysis functions
  - `analyse<const N: usize>(img: RgbImage) -> [Rgb<u8>; N]` - Divides images into sqrt(N)×sqrt(N) grids and computes average colors
  - Uses const generics for compile-time grid size (common values: 1, 4, 9, 16, 25, 32, etc.)
  - `get_img_colors<const N: usize>()` - Extracts colors from source image regions for matching

### Rendering Modes
- **rendering.rs**: Three main rendering algorithms
  - `render_nto1()` - Default mode: matches each N×N pixel region to best tile using k-d tree nearest neighbor search
  - `render_nto1_no_repeat()` - No-repeat mode: uses Hungarian algorithm for optimal tile assignment without duplicates
  - `render_random()` - Random mode: ignores source image, useful with tint overlay for logos

### Tile Management
- **tiles/tileset.rs**: `TileSet<T>` - Generic container for tiles with associated color data
  - Stores both tile metadata and preprocessed images
  - Supports map operations to transform color representations
  - Serializable for caching analyzed tiles (`.emosaic_*` files)

- **tiles/tile.rs**: `Tile<T>` - Individual tile with path and color analysis
  - Generic over color representation (e.g., `[Rgb<u8>; N]` for N-segment grids)

### Algorithms and Optimization
- **algorithms.rs**: Utility functions for k-d tree matching
- **color.rs**: Color space conversions and distance metrics
- Uses `kiddo` crate for efficient k-d tree nearest neighbor search
- Uses `rayon` for parallel tile processing and rendering

### Web Output
- **web/**: HTML generation with interactive features
  - `main_page.rs` - Full HTML page with embedded mosaic and tile viewer
  - `html_stats.rs` - Statistics display in HTML
  - `widget.rs` - Embeddable widget for external sites
  - Integrates with AWS backend for tile flagging (inappropriate content reporting)

## AWS Backend (aws-backend/)

Full cloud rendering pipeline plus tile flagging:

- **24 Python Lambdas**:
  - 3 tile-flagging (`toggle_flag`, `get_flags`, `admin_get_all_flags`)
  - 20 mosaic API (`lambda/mosaic/*.py`): `create_mosaic`, `submit_job`, `list_mosaics`, `get_mosaic`, `update_mosaic`, `delete_mosaic`, `set_main_mosaic`, `cancel_job`, `list_jobs`, `get_job`, `image_upload`, `get_upload_url`, `get_tile_count`, `list_tile_folders`, `registration`, `user_management`, `captcha`, `custom_message`, `log_error`, `list_errors`
  - 1 EventBridge trigger (`job_completed`) — updates DynamoDB and invalidates CloudFront when Batch jobs finish
- **DynamoDB tables**: `${env}-tile-flags`, `${env}-rate-limits`, `${env}-mosaics`, `${env}-mosaic-jobs`
- **AWS Batch**: ECR + compute environment + job queue + job definition; runs the Docker-packaged binary
- **API Gateway**: REST APIs (Cognito auth on admin/user endpoints, public + rate-limited on tile flagging)
- **Cognito**: `${env}-emosaic-admin-pool`
- **CloudFormation stacks** (11 templates in `aws-backend/cloudformation/`): `tile-flags-infrastructure`, `mosaic-infrastructure`, `job-handler`, `batch-infrastructure`, `mosaic-api`, `phase3-enhancements`, `user-management`, `image-upload`, `domain-certificate` (us-east-1), `admin-ui-infrastructure`, `api-gateway`

Deploy scripts (in `aws-backend/`):

- `deploy-cloud.sh` — full stack deployment (current canonical script). Env vars: `ENVIRONMENT`, `AWS_REGION`, `ADMIN_EMAIL`, `CORS_ORIGIN`, `VPC_ID`, `SUBNET_IDS`, `CUSTOM_DOMAIN`, `HOSTED_ZONE_ID`, `CLEAN_FIRST`.
- `deploy.sh` — legacy tile-flagging-only deployment.
- `cleanup-cloud.sh`, `cleanup_and_redeploy.sh` — teardown helpers.
- `deploy-admin-ui.sh` — build + ship the React app.
- `update-api-endpoint.sh` — patches the embedded widget JS with the live API URL.
- `test-api.sh`, `test-batch.sh`, `test-phase3.sh` — smoke tests.

CLI tools (Python):

- `tile_manager.py` — list/review/delete flagged tiles.
- `user_manager.py` — Cognito user admin.
- `backfill_image_hashes.py` — one-shot data migration.

Detailed runbook in `DEPLOYMENT.md` and `aws-backend/README.md`.

## Container (Dockerfile, docker/, build-and-push.sh)

Multi-stage Dockerfile builds the Rust binary (using `rust:1.75-slim` + the pinned nightly toolchain), then bakes it into a `debian:bookworm-slim` runtime with AWS CLI and ImageMagick. `docker/entrypoint.sh` is what AWS Batch actually executes — it sync's tiles from S3, runs `emosaic`, and uploads results.

`./build-and-push.sh` (repo root) builds the image, runs the test suite first, and pushes to the ECR repo created by the `${env}-batch-infrastructure` stack. Env vars: `ENVIRONMENT` (default `prod`), `AWS_REGION` (default `eu-west-3`), `IMAGE_TAG` (default `latest`).

## Admin UI (admin-ui/)

React 19 + TypeScript + Vite + Tailwind v4 + AWS Amplify v6 (Cognito) + TanStack Query v5 + React Router v7.

- `npm run dev` — local dev server (http://localhost:5173)
- `npm run build` — production build to `dist/`
- `./generate-env.sh <env> <region>` — populate `.env` from CloudFormation outputs
- `./deploy.sh` — build + sync to S3 + invalidate CloudFront

Cross-cutting: see `admin-ui/README.md` for env vars and deployment.

## Entry Point (src/main.rs)

CLI built with clap v3. Top-level args apply to both subcommands:

- `<IMG>` (positional, required) — source image
- `-s, --tile-size <N>` (default `16`)
- `-o, --output-path <PATH>` (default `./output.jpg`) — note the binary always writes PNG-encoded data regardless of extension
- `--crop` — crop tiles to square instead of resizing

Subcommands:

- `prepare` — turn the source image into a single tile (preview tile preprocessing)
- `mosaic <TILES_DIR>` with options: `-m/--mode` (`1|2|3|4|5|6|8|16|32|64|128|random`, default `1`), `-t/--tint-opacity` (0..1), `--no-repeat`, `--greedy`, `--randomize` (0..100), `--downsample`, `--extensions` (default `jpg jpeg`), `--html`, `--web`, `--title`, `-f/--force`

Nightly features used: `generic_const_exprs`, `type_changing_struct_update`. The toolchain is pinned in `rust-toolchain.toml`.

## Key Design Patterns

1. **Const Generic Grid Sizes**: Tile analysis uses `<const N: usize>` to support different grid granularities at compile time
2. **Parallel Processing**: Heavy use of rayon for tile analysis and rendering
3. **Caching**: Analyzed tiles saved to `.emosaic_*` files in tile directory (use `-f` to force re-analysis)
4. **Mode System**: Multiple rendering strategies with different quality/performance tradeoffs

## Important Implementation Details

- **Tile Preparation**: Tiles can be cropped or resized (default) to square format
- **Tinting**: Source image can be overlayed with transparency for color correction
- **No-Repeat Algorithm**: When `--no-repeat` is used, the codebase employs sophisticated assignment algorithms to avoid tile duplication while maintaining quality
- **Downsample**: Can downsample source image to reduce output size
- **Randomization**: `--randomize` option selects from best matches within X% distance for variety

# Rust Toolchain

- Requires **nightly** Rust (see rust-toolchain.toml)
- Uses unstable features for const generics with expressions
- Key dependencies: image (0.25), clap (3.2), rayon (1.10), kiddo (4.2 for k-d trees)

# Source Control

The repo is a git repository. Sapling (`sl`) sits on top of git for some workflows; both are valid:
- Plain git: `git status`, `git diff`, `git commit -m "..."`, `git log`
- Sapling (if installed): `sl status`, `sl diff`, `sl commit -m "..."`, `sl amend`

# Best Practices

- Run `cargo test` before committing changes to core mosaic logic
- Use `cargo clippy` to catch common issues
- Test with different MODE values (1, 4, 9, 16, 25, 32) when changing analysis/rendering code
- When modifying tile analysis, verify that cache invalidation works correctly (test with `-f` flag)
- For web output changes, test the generated HTML in a browser
