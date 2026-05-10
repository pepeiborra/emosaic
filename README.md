# emosaic

Photo mosaic generator (Rust) plus a small AWS-hosted system for running it on demand. Started as a fork of [willdady/emosaic](https://github.com/willdady/emosaic); now spans four components:

| Path | What it is |
|------|------------|
| `src/` | Rust binary `emosaic` — the mosaic engine. Reads a source image + a directory of square tiles, emits a mosaic and an interactive HTML viewer. |
| `Dockerfile`, `docker/`, `build-and-push.sh` | Container that ships the binary to ECR for AWS Batch. |
| `aws-backend/` | CloudFormation, Lambdas (24), Cognito, DynamoDB, API Gateway, AWS Batch — the cloud rendering pipeline + tile-flagging backend. |
| `admin-ui/` | React + Vite admin app (deployed to CloudFront). User-facing UI for creating/managing mosaics. |
| `Makefile` | Local "render + upload to S3 + invalidate CloudFront" workflow for the maintainer's personal site (casadelmanco.com). |
| `example/` | Sample outputs. |
| `docs/archive/` | Historical planning notes — not maintained. |

The deployed instance is **casadelmanco.com**.

For the cross-component picture see [ARCHITECTURE.md](./ARCHITECTURE.md).
For deploying the cloud stack see [DEPLOYMENT.md](./DEPLOYMENT.md).
For the backend internals see [aws-backend/README.md](./aws-backend/README.md).
For the admin UI see [admin-ui/README.md](./admin-ui/README.md).

---

## Run the generator locally

The Rust binary is fully usable on its own; AWS is only needed for the cloud pipeline.

### Prerequisites

- **Nightly Rust** (auto-selected by `rust-toolchain.toml`). If you don't have it: `rustup toolchain install nightly`.
- A **tiles directory**: a folder of roughly square images (`.jpg`/`.jpeg` by default). The repo root has a `tiles_dir` symlink pointing at the maintainer's iCloud "Fotos campo" folder.
- A **source image** (jpg/jpeg/png/bmp/gif/tiff/webp). The `mosaico` symlink points at the maintainer's working folder.

### Build

```bash
cargo build --release        # → target/release/emosaic
cargo test --release         # full test suite
```

### Direct invocation

```bash
cargo run --release -- <SOURCE_IMG> [global-opts] mosaic <TILES_DIR> [mosaic-opts]
```

Minimal example:

```bash
cargo run --release -- input.jpg mosaic ./tiles_dir
```

Realistic example (matches what the Makefile does):

```bash
cargo run --release -- \
    input.jpg \
    --tile-size 32 --crop \
    --output-path /tmp/out.jpg \
    mosaic ./tiles_dir \
    --mode 32 --no-repeat --web --title "My Mosaic"
```

### CLI reference

Top-level (apply to all subcommands):

| Flag | Default | Notes |
|------|---------|-------|
| `<IMG>` | required | Source image path. |
| `-s, --tile-size <N>` | `16` | Pixel size of each tile in the output. |
| `-o, --output-path <PATH>` | `./output.jpg` | Output file. **Always written as PNG**, regardless of the file extension. |
| `--crop` | off | Crop tiles to square instead of resizing them. |

Subcommands:

- `prepare` — Convert the source image into a single tile (trim+resize). Useful for previewing what tile preprocessing does to a given input.
- `mosaic <TILES_DIR>` — Generate a mosaic. Options:

| Flag | Default | Notes |
|------|---------|-------|
| `-m, --mode <MODE>` | `1` | One of `1`, `2`, `3`, `4`, `5`, `6`, `8`, `16`, `32`, `64`, `128`, `random`. Higher numbers split tiles into more colour-sample regions for finer matching (compile-time `N×N` grid via const generics). `random` ignores the source image — pair it with `--tint-opacity` for logo-style outputs. |
| `-t, --tint-opacity <0..1>` | `0.0` | Overlay the source image over the mosaic at the given opacity. |
| `--no-repeat` | off | Use the Hungarian algorithm to assign each tile at most once. |
| `--greedy` | off | When combined with `--no-repeat`, use a faster but lower-quality assignment. |
| `--randomize <0..100>` | off | Pick a random tile within X% distance of the best match (adds variety). |
| `--downsample <N>` | `1` | Downsample the source image by N before matching. Reduces output size. |
| `--extensions <ext>...` | `jpg jpeg` | File extensions to scan in the tiles dir. Repeat the flag for multiple. |
| `--html` | off | Generate an interactive HTML viewer (hover for tile details). |
| `--web` | off | Generate web-compatible HTML (relative URLs, S3-friendly). |
| `--title <STRING>` | `"Mosaic Widget"` | Title in the generated HTML. |
| `-f, --force` | off | Invalidate the tile-analysis cache (`.emosaic_*`) and re-analyse from scratch. |

### Outputs

Every run writes:

- `<output>.<ext>` — the mosaic (PNG-encoded)
- `<output>.stats.png` — heatmap of per-tile match distance
- `<output>.stats.json` — match statistics, tile usage, distance distribution
- `<output>.html` and/or `<output>_widget.html` if `--html` / `--web` were passed
- `.emosaic_<N>to1[_cropped]` written **inside the tiles directory** — analysis cache. Delete it or pass `-f` after adding/removing tiles.

The general analysis cache also lives at `~/.cache/mosaic` (or platform equivalent via the `dirs` crate).

---

## Run via the Makefile

The Makefile is the maintainer's batteries-included path: it wraps the `cargo run` invocation with sensible flag combinations and wires it to S3 + CloudFront.

| Target | What it does |
|--------|--------------|
| `make generate` | Render only. Output goes to `/tmp/<timestamp>/`. |
| `make upload` | `generate` + `aws s3 sync` of the output folder to `S3_BUCKET`. |
| `make deploy` | `upload` + copy `<name>_widget.html` to `index.html` in S3 + invalidate CloudFront. |
| `make check-deps` | Verify `cargo`, `aws` CLI, and AWS credentials are present. |
| `make check-input` | Verify the input file exists. |
| `make help` | Print built-in help. |

Variables (override on the command line, e.g. `make generate FILE=foo.jpeg TILE_SIZE=16`):

| Variable | Default | Notes |
|----------|---------|-------|
| `FILE` | `marco2.jpeg` | Filename inside `mosaico/` (the symlinked working dir). |
| `TILE_SIZE` | `32` | Passes through as `--tile-size`. |
| `MODE` | `32` | Passes through as `--mode`. |
| `OPACITY` | `0` | Passes through as `--tint-opacity`. |
| `MORE` | `no-repeat` | Space-separated list of long flags to splice in (e.g. `MORE="no-repeat greedy"`). |
| `CROP` | `1` | `1` adds `--crop`. |
| `FORCE` | `0` | `1` adds `--force`. |
| `DOWNSAMPLE` | `1` | Passes through as `--downsample`. |
| `TITLE` | `Casa del Manco` | HTML title. |
| `TILES_DIR` | `./tiles_dir` | Path to tile images. The default resolves the repo-root `tiles_dir` symlink — re-point that symlink to swap tile sources rather than overriding the variable. |
| `S3_BUCKET` | `casadelmanco.com` | Used by `upload`/`deploy`. |
| `DISTRIBUTION_ID` | `E2KW8FQIKWXD1D` | CloudFront distribution to invalidate on `deploy`. |

Output filename pattern: `<FILE>_<TILE_SIZE>_<MODE>_<OPACITY>_<DOWNSAMPLE>[_<MORE>][_cropped]`.

---

## Cloud pipeline at a glance

The admin UI lets a user upload images, pick parameters, and request a mosaic. That request travels through API Gateway → Lambda → AWS Batch, where the Docker-packaged `emosaic` binary runs against tiles and source images stored in S3. On completion an EventBridge rule fires another Lambda that updates DynamoDB and invalidates CloudFront. Authentication is via Cognito.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full picture and [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment.
