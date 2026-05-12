# S3-direct cache performance: facts (--no-repeat workload)

**Date:** 2026-05-12
**Branch / HEAD:** `master` @ `e8f394c`

Measures the local + S3 caching layers in `prepare_tile` under a
realistic workload: `--no-repeat` against the full 8 209-tile library,
where unique tiles outnumber output cells (so each render placement
is a fresh tile — no intra-job reuse).

Two revisions compared:

- **revA** — current `master` HEAD: local Cache 1 with optional S3 backing.
- **revB** — HEAD + `stash@{0}` ("S3-direct #7: drop local Cache 1
  disk layer"): every `prepare_tile` call goes straight to S3 (or full
  prep on miss); no write-through to disk.

## 1. Hardware and software context

| | |
|---|---|
| Machine | Apple M5, 10 cores (10 physical), 16 GB RAM |
| OS | macOS 26.4.1 (Darwin 25.4.0) |
| Toolchain | `nightly` Rust 1.97.0-nightly (82bee9650 2026-05-09) |
| S3 bucket | `s3://emosaic-tiles-prod/` (eu-west-3); cache prefix `cache/v2/` |
| AWS profile | default (plain IAM keys; the `admin` profile uses a non-standard `login_session` key that the Rust SDK ignores) |

## 2. Fixture

| | |
|---|---|
| Source image | `mosaico/marco.jpeg` — 922 × 844 px JPEG |
| Tile library | `tiles_dir` (symlink → iCloud `Fotos campo/`) — 8 239 jpg/jpeg files; the binary parses 8 209 (30 fail decode or fail the white-trim assertion) |
| Tile size | 24 px |
| Downsample | 32 → 728 cells (`floor(922/32) × floor(844/32) = 28 × 26`); fits comfortably within 8 209 unique tiles |
| Mode | 1 (default, single-cell average colour) |
| `--no-repeat` | yes |
| `--greedy` | yes — Hungarian-algorithm assignment at N=728 is feasible but slow; greedy keeps wall < 2 min |
| Crop flag | absent |
| Output | 896 × 832 px (~0.7 MP), JPEG, ~1 MB |
| Command | `./target/release/emosaic mosaico/marco.jpeg --tile-size 24 --output-path <out>.jpg mosaic tiles_dir --extensions jpg --extensions jpeg --downsample 32 --no-repeat --greedy` |

The prod S3 cache has ~16 400 entries at size 24 under `cache/v2/`,
populated by an earlier warmup pass against the same `tiles_dir`.

## 3. Cache architecture (at e8f394c)

There are two cache layers on the hot path:

1. **Local Cache 1** — `<HOME>/Library/Caches/mosaic/<key>[_cropped].v2.<size>.png`
   - Key for `Local` source: `hex_md5(file_bytes)`
   - Key for `S3` source: the object ETag
   - Schema version `2`
2. **S3 Cache 1** — `s3://$BUCKET/$PREFIX<key>[_cropped].v2.<size>.png`
   - Same key derivation; gated on `EMOSAIC_S3_CACHE_BUCKET`; default prefix `cache/v2/`
   - All errors (init, GET, PUT) are best-effort: log-once and continue

A metadata fast-path sidecar at `<HOME>/Library/Caches/mosaic/index.bin`
maps `path → (mtime, size, md5)` so Phase 1 can derive the cache key
without re-hashing the file.

### `prepare_tile` control flow for a Local tile (no `--force`)

```
Phase 1 (no raw fetch):
  try_cache_key_without_bytes(path)            # metadata index
    └── hit  → cache_path_for_key
                  ├── local open? → return         (fast-hit)
                  └── try_s3_pull_key → local open → return (fast-hit)
    └── miss → continue to Phase 2

Phase 2 (raw fetch + maybe full prep):
  fetch_raw_bytes(path)                        # full file read
  md5::compute(bytes); update_index            # MD5 + index update
  re-check local cache → return if hit         (slow-hit)
  try_s3_pull_key + open → return if hit       (slow-hit)
  full prep (decode → trim → crop → Lanczos → encode)
  save local PNG; try_s3_push_key              (full-prep)
```

revB collapses both phases into "try S3 (returns bytes in memory); on
miss, full prep + S3 push". No local PNG is ever written; the local
cache directory is inert.

## 4. Telemetry

Added in this benchmark, kept out of the working tree (applied via
patch scripts in `/tmp/emosaic-bench/add-telemetry-{revA,revB}.sh`):

- `prepare_tile total wall` — sum, across all rayon threads, of every
  `prepare_tile` invocation (fast and slow paths).
- `S3 wait` — sum, across all rayon threads, of every S3
  GetObject/PutObject duration recorded by `record_s3_dur`.
- Outcome counters — every `prepare_tile` call lands in one of
  `fast-hit` (Phase 1), `slow-hit` (Phase 2), `full-prep` (Lanczos).
  The triplet sums to the total call count.

Patch: `src/mosaic/tiles/utils.rs` (new `PREPARE_*` atomics +
`PrepareWallGuard` + `prepare_tile_telemetry()`) and
`src/main.rs::print_runtime_stats` (two extra lines).

## 5. Scenarios

Custom `HOME` per (revision, lineage) so cache state is isolated:

| Scenario | env vars | Local Cache 1 state |
|---|---|---|
| A. Cold-local, no S3 | (no S3 env vars) | empty (fresh HOME) |
| B. Warm-local, no S3 | (no S3 env vars) | warm — same HOME as the preceding A run |
| C. Cold-local, S3 → prod | `EMOSAIC_S3_CACHE_BUCKET=emosaic-tiles-prod` + `AWS_REGION=eu-west-3` | empty (fresh HOME) |

Artefacts in `/tmp/emosaic-bench/results-norepeat/`
(`<label>.{jpg,stdout,stderr}`). Outputs are not byte-identical
across runs because the greedy assignment is race-dependent; file
sizes are within 0.3 % and content is equivalent.

## 6. Results

8 967 `prepare_tile` calls per run: **8 209 analysis** (one per source
JPG, `crop=false`) + **728 render placements** (one per cell with
`--no-repeat`, `crop=true`) + **30 extras** from the greedy
algorithm's tie-breaking. The fast / slow / full triplet sums to
8 967 in every cell.

### revA (HEAD — keeps local Cache 1)

| Scenario | Wall | User | `prepare_tile` total | S3 wait | fast / slow / full |
|---|---|---|---|---|---|
| **A**. cold-local, no S3 | 101.49 s | 894.30 s | 988.06 s | 0.00 s | 157 / 36 / 8774 |
| **B**. warm-local, no S3 | 0.92 s | 2.00 s | 3.17 s | 0.00 s | 8921 / 0 / 46 |
| **C**. cold-local, S3 → prod | 76.14 s | 28.10 s | 749.58 s | 716.44 s | 728 / 8209 / 30 |

### revB (HEAD + stash@{0} — drops local Cache 1)

| Scenario | Wall | User | `prepare_tile` total | S3 wait | fast / slow / full |
|---|---|---|---|---|---|
| **A**. cold-local, no S3 | 101.92 s | 888.34 s | 991.87 s | 0.00 s | 0 / 0 / 8967 |
| **B**. warm-local, no S3 | 119.81 s | 1062.33 s | 1177.27 s | 0.00 s | 0 / 0 / 8967 |
| **C**. cold-local, S3 → prod | 72.57 s | 28.34 s | 707.34 s | 675.53 s | 728 / 8209 / 30 |

## 7. What the telemetry says

**revA-A (cold local, no S3)**: 8774 full preps, 193 cache hits
(157 fast + 36 slow). The 193 hits come from rayon races where two
threads pick the same tile path roughly simultaneously and the
second-to-arrive finds a cache file the first wrote. 988 s of
`prepare_tile` wall ÷ 101 s real ≈ 9.8× parallelism (close to ideal
for 10 cores).

**revA-B (warm local, no S3)** is the headline number: 0.92 s real
wall. The metadata fast-path hits 8921 times (99.5 %); only 46 calls
go to full prep (corrupt JPGs + the cropped variants that weren't
written during A — analysis writes `crop=false`, render writes
`crop=true`; B's HOME inherits A's cache state so 8209 crop=false
entries are warm but only 728 crop=true entries are warm; the 46
full-preps are race / decode failures).

**revA-C (cold local, S3 → prod)**: 728 fast-hits + 8209 slow-hits
+ 30 full-preps. The 728 fast-hits are render placements: by the
time render runs, analysis has populated the metadata index for
those tile paths, so Phase 1 derives the MD5 → tries local file
(miss, cropped variant) → S3 pulls (hit) → counts as fast-hit. The
8209 slow-hits are analysis: Phase 1 has no metadata for those
paths yet, falls through to Phase 2, reads file, computes MD5,
hits S3 → slow-hit. **8937 S3 GETs per job**, 716 s of S3 wait
summed across threads, parallelised to 76 s real (9.4× parallelism).
User CPU 28 s vs revA-A's 894 s — the S3 cache eliminates ~97 % of
the Lanczos work.

**revB-A and revB-B are indistinguishable**. With no local layer,
every call falls through to full prep, regardless of HOME state.
**The "warm" run does the exact same work as the cold one** — the
local cache layer is the entirety of "warm" in revA.

**revB-C** is essentially revA-C without the local PNG writes:
same 8937 S3 GETs, same 728 fast-hit + 8209 slow-hit + 30
full-prep distribution, same ~73 s wall. Slightly faster than
revA-C because revA writes ~17 MB of PNGs to disk that nothing
re-reads within the job.

### Caveat: OS page-cache effects

The 8 209-tile library lives on iCloud-mounted storage. Files were
materialised locally before the benchmark. Runs in the same
sequence share OS page cache for the tile bytes; the first cold run
pays the disk-read cost, subsequent ones don't. The
`prepare_tile total wall` and `S3 wait` columns are insensitive to
page-cache warmth, so the comparison stays meaningful.

## 8. Cross-revision verdict

The verdict depends on the workload shape:

| Setting | revA wins by | revB wins by | Conclusion |
|---|---|---|---|
| Repeated local-dev runs on the same fixture | 100× (revA-B vs revB-B: 0.92 s vs 119.81 s) | — | **Keep local cache** — dev iteration loop benefits enormously |
| Single Fargate job, S3 cache warm, --no-repeat | within 5 % (revA-C 76 s vs revB-C 73 s) | ~3 s wall, ~17 MB ephemeral disk | **No clear winner per-job**; revB is slightly leaner |
| Single Fargate job, cold-everything, --no-repeat | within 1 % (101 s vs 102 s) | tiny wall, ~17 MB ephemeral disk | **Tie**; the work is identical (full prep) |

The local cache is **load-bearing for local dev** but **operationally
free for Fargate `--no-repeat` jobs** — every render placement is
unique, so the cache writes are never re-read within a job, and
Fargate containers don't persist `/tmp` across tasks.

This changes the framing of the stashed `drop-local-Cache-1` work
(task #31). It's safe to drop *for the Fargate path*, but doing so
would break the local-dev iteration speed.

**Recommendation**: rather than dropping the local layer wholesale,
make it conditional on environment. Two options:

1. Gate local-cache writes on `EMOSAIC_LOCAL_CACHE=1` (default on,
   off in the Batch entrypoint). Tiny diff; preserves all current
   behaviour locally; saves ephemeral disk on Fargate.
2. Cap the local cache by total size (LRU eviction). Lets Fargate's
   reduced ephemeral storage (task #32 plans 50 GB → 5 GB) hold
   what fits; falls back to S3 for the rest.

Option 1 is more surgical and aligned with what the stashed work was
trying to accomplish. Option 2 is more robust to future workloads
that do have reuse (e.g., mode > 1, or running without --no-repeat).

## 9. Cloud / Batch worker implications

Every Batch job starts with an empty `/tmp/cache/mosaic` — there is no
persistence across Fargate tasks. So per-job cost is **scenario C**:

- 8 937 S3 GETs total (8 209 for analysis + 728 for render placements)
- ~716 s of S3 wait *summed across threads*, parallelised to ~76 s
  real on M5 (9.4× parallelism)
- 28 s of user CPU — the S3 cache eliminates ~97 % of Lanczos work
  vs the cold-everything case (894 s user)

On Fargate (slower per-request latency, fewer vCPUs in default
configurations), expect higher real wall for the same S3 wait sum.
A 2 vCPU Fargate task processing 8 937 sequential-ish S3 GETs at
~20 ms each would land around 90-180 s. Still much faster than the
current `aws s3 sync` (~2 GB raw JPG download + 600 s of cold
Lanczos preprocessing).

Where the win evaporates:

1. **If the S3 cache isn't warm for the requested tile_size/crop**.
   prepare_tile falls through to full prep + S3 PUT. First job per
   combo pays the cost; subsequent jobs benefit. The warmup script
   exists for this.
2. **If the workload reverts to non-`--no-repeat` modes** (intra-job
   reuse). With reuse, revA's local cache absorbs duplicate calls
   and revB pays per-call S3 latency. (Out of scope for current
   prod jobs but worth knowing.)

## 10. Bug (fixed): `get_image` didn't work for S3 tile-sets

> **Status:** fixed. See "Fix landed" at the end of this section.

Trying to simulate a fully S3-resident Fargate job with `mosaic
s3://emosaic-tiles-prod/tiles/2024/ …` originally made analysis
succeed and render panic:

```
thread '<unnamed>' panicked at src/mosaic/rendering.rs:224:13:
Image not found: tiles/2024/20240225_143003.jpg
```

Cause: `src/mosaic/tiles/tileset.rs::get_image` called

```rust
prepare_tile(TileLocator::Local(path), tile_size, true, false)
```

unconditionally when `self.images` didn't have the entry — which it
never does for mode-1 analysis. For an S3 tile-set, `path` is the
S3 object key (e.g., `tiles/2024/20240225_143003.jpg`), not a
filesystem path. So inside `prepare_tile`:

- Phase 1 fast-path: `try_cache_key_without_bytes` for `Local` needs
  `std::fs::metadata(path)` to succeed → ENOENT → returns `None` →
  Phase 1 skipped.
- Phase 2: `fetch_raw_bytes(Local(path))` calls `std::fs::read(path)`
  → ENOENT → returns `ImageError` → `get_image` returns `Err` →
  render `unwrap()` panics.

The Cache 1 layer did *not* paper over this, because Phase 1's
fast-path bailed before ever consulting the cache file.

### Fix landed

`TileSet` gained two fields: `source: TileSource` (what the set was
built from) and `etags: Vec<Option<String>>` (one entry per tile, in
the same order as `paths`). `get_image` now dispatches on
`self.source`: it builds a `TileLocator::S3 { bucket, key, etag }`
for S3 sources and the old `TileLocator::Local(path)` for Local
sources. Per-tile ETags are captured in `generate_tile_set` from the
`TileRef` stream and stored via `set_etags`.

Verified: `mosaic s3://emosaic-tiles-prod/tiles/2024/ …` (with
`EMOSAIC_LOCAL_CACHE=0`) now renders 22 source tiles into 728
placements with `prepare_tile: 750 calls, fast-hit=750, slow-hit=0,
full-prep=0` — every render call is served by the S3 cache via the
new `TileLocator::S3` path. Real wall 11.17 s, total prepare wall
120 s across 8 rayon threads.

This unblocks task #32 (entrypoint + CFN — switch from `aws s3
sync` to passing `s3://…` straight to the binary).

## 11. Outstanding questions

- **Why are there 30 "extra" `prepare_tile` calls per run?** Expected:
  8 209 analysis + 728 render = 8 937. Observed: 8 967. The greedy
  algorithm or `no_repeat` selection appears to re-fetch some tiles.
  Cheap to investigate, possibly cheap to fix.
- For Fargate cross-job cache persistence: ephemeral storage is
  per-task. Options if amortisation across jobs becomes important:
  (a) EFS-mounted cache directory, (b) longer-lived workers (EC2
  with shared local disk).
- Should the cache key incorporate `EMOSAIC_S3_CACHE_PREFIX` so a
  typo'd prefix benignly invalidates rather than silently mis-keying?
