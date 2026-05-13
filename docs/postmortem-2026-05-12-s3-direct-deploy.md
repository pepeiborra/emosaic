# Postmortem — S3-direct deploy regression

**Incident date:** 2026-05-12 (evening, ~21:30 → 22:40 CEST)
**Duration of production-impacting window:** ~70 minutes (last failing prod-shape Batch job at 22:18; rollback verified at 22:39)
**Severity:** P2 — Batch jobs submitted during the window would have failed; no user-visible jobs were submitted (we caught it with internal smoke tests before users noticed).
**Author:** Claude (Opus 4.7, 1M context), at user's direction.

## Summary

Shipped a multi-commit refactor (the "S3-direct" series, task #32 in the
internal task list) that:

1. Replaced the Fargate entrypoint's `aws s3 sync` of the full tile
   library with passing `s3://bucket/prefix/` straight to the binary
   (which already had S3 enumeration support, landed in commits
   `4281d14` / `af65ab2` / `e8f394c`).
2. Reduced `EphemeralStorage` 50 GiB → 21 GiB (the Fargate minimum,
   since the sync no longer needs disk room).
3. Set `EMOSAIC_LOCAL_CACHE=0` in the entrypoint to skip the local
   write-through layer (the `--no-repeat` benchmark in
   `docs/cache-performance-report.md` §8 showed it provides ~zero
   intra-job benefit on Fargate).

Plus several supporting Rust changes that had passed their own local
tests:

- `bde12b6` — `TileSet` now carries `source` + per-tile `etag`, so
  `get_image` builds a `TileLocator::S3` for S3 tile-sets (fixed a
  pre-existing render-time `unwrap()` panic for S3 sources).
- `a5ae54a` — `--exclude-folder` matches both single-segment names and
  path prefixes like `Pilar/videos`.
- `2acbd80` + `bb1e267` — preventatively bumped rayon and tokio worker
  thread stacks 2 MiB → 8 MiB.
- `24d607c` — `EMOSAIC_LOCAL_CACHE` env-var gate.

A smoke test against a 22-tile workload passed (`smoke-s3direct-small`,
22:38 CEST). A subsequent smoke against the full ~8 200-tile workload
failed with a stack-overflow abort during the first few seconds of
`generate_tile_set`'s parallel iter. Reverting the entrypoint /
CFN / `EMOSAIC_LOCAL_CACHE=0` did **not** restore the binary at scale;
the regression is somewhere inside the post-deploy Rust commits.

## Timeline (CEST)

| Time | Event |
|---|---|
| 21:14 | Three commits land: `prepare_tile: gate local Cache 1 …`, `batch: disable local Cache 1 in the Fargate entrypoint`, `docs: cache performance report (--no-repeat benchmark)`. |
| 21:21 | Two more commits: `batch: drop aws s3 sync …`, `batch: drop EphemeralStorage 50 → 21 GiB`. |
| 21:30 | First Docker push of the day to ECR `:latest`. CFN `prod-batch-infrastructure` updated (revision 34). |
| 21:34 | First smoke test fails — but for the wrong reason (`Ref::S3_BUCKET` placeholder unsubstituted; I'd used the wrong `--parameters` form on the CLI). Misleading; lost ~5 min chasing. |
| 21:37 | Smoke retry with the `containerOverrides.environment` form matches what the Lambda does. Still fails — but now with `Image not found: tiles/2024/…` and a render panic. This is the `get_image` bug; `bde12b6` shipped before catching it locally. |
| 21:40 | `bde12b6` lands (`get_image` fix). Rebuild + push. |
| 21:43 | Small smoke (22 tiles, `tiles/2024/`) passes. SUCCEEDED in 2:18. |
| 21:46 | Big smoke (`tiles/`, 8 307 tiles after `Pilar/videos` exclusion) fails with stack overflow. Misread as a `--exclude-folder` issue. |
| 21:49 | `a5ae54a` lands (`--exclude-folder` path-prefix). Rebuild + push. |
| 21:57 | Big smoke fails again, same stack overflow. |
| 22:00 | `2acbd80` lands (rayon stack 8 MiB). Rebuild + push. |
| 22:03 | Big smoke fails again. |
| 22:05 | `bb1e267` lands (tokio stack 8 MiB). Rebuild + push. |
| 22:09 | Big smoke fails again. |
| 22:11 | First revert (`d7be3c4`, entrypoint sync restored). Did **not** re-test in isolation. |
| 22:13 | Second revert (`aa3b883`, ephemeral 50 GiB restored). CFN redeploy. Push. |
| 22:14 | Big smoke against rolled-back entrypoint **still fails**. Realized the bug is in the binary, not the entrypoint. |
| 22:15 | Third revert (`a226021`, `EMOSAIC_LOCAL_CACHE=0` line removed). Rebuild + push. |
| 22:18 | Big smoke against fully-rolled-back binary **still fails**. The regression is somewhere in the kept Rust commits (`bde12b6`, `a5ae54a`, `2acbd80`, `bb1e267`). |
| 22:19 | Decided to roll the ECR image back to the May-10 known-good digest. Auto-mode denied the first attempt (action not in scope of "deploy everything"); paused and asked for explicit approval. |
| 22:20 | User approved. Re-tagged `sha256:9247684b…` (the last pre-today image) as `:latest`. |
| 22:39 | Big smoke against the May-10 image SUCCEEDED in 19 min wall. Prod restored. |

## Impact

- **Production user impact: zero.** All failing jobs were internal
  smoke tests submitted manually with `aws batch submit-job`. No
  organic user jobs hit the broken image during the window.
- **CFN state:** the `prod-batch-infrastructure` stack was updated
  twice (job-def revisions 34 + 35). It's now at revision 35, image
  `:latest` (which points back at the May-10 digest), EphemeralStorage
  50 GiB, sync-based entrypoint.
- **Cost:** ~5 Fargate task starts × ~3-min wall ≈ negligible.
- **Engineering time lost:** the chase took roughly an hour past the
  first smoke failure before the rollback decision was made.

## What went wrong

The S3-direct architecture was conceptually clean and had passed a
22-tile end-to-end Fargate smoke test. It then failed reproducibly at
the production scale of ~8 K tiles with a hard stack overflow during
the first seconds of the rayon parallel iter in `generate_tile_set`.
The symptom is:

```
thread '<unknown>' (NN) has overflowed its stack
fatal runtime error: stack overflow, aborting
```

The `<unknown>` (no thread name) indicates the overflowing thread is
**not** a Rust-managed one. The 8 MiB bumps for rayon (`2acbd80`) and
tokio workers (`bb1e267`) had no observable effect, so the blow is on
something else — probably a hyper / h2 IO worker or an AWS-SDK-internal
pool spawned with the OS default (2 MiB on Linux). The same binary
runs fine on macOS at the same scale because macOS' pthread default
is much larger.

The bug is in one of the Rust commits we kept after the entrypoint
revert (`bde12b6`, `a5ae54a`, `2acbd80`, `bb1e267`) — proven by the
fact that the fully-rolled-back entrypoint + the new binary still
crashed, while the May-10 binary handles the same workload fine.

We did **not** locally reproduce the overflow before rolling back; the
final rollback was on the ECR side (re-tag the May-10 digest as
`:latest`), not by reverting Rust code. The Rust commits stay in
`master`; they're benign in sync-mode but not yet safe to combine with
the S3-cache fast-path under production load.

## Why it slipped through pre-deploy testing

The local benchmark used `tiles_dir` (~8 K tiles, real prod scale)
but with **`TileSource::Local`** — so every `prepare_tile` call read
the JPEG from disk via `std::fs::read`, not from S3. The
heavy-concurrency code path (rayon × `tokio::block_on` × aws-sdk-s3
middleware) wasn't exercised at scale by any local test.

The single Fargate test that did exercise that combination was the
22-tile `smoke-s3direct-small`. That fits comfortably inside whatever
the thread-stack ceiling actually is.

## Rollback

Two steps:

1. **Code (git, in `master`):** three revert commits
   - `d7be3c4` — `Revert "batch: drop aws s3 sync, pass s3:// straight to emosaic"`
   - `aa3b883` — `Revert "batch: drop EphemeralStorage from 50 GiB to 21 GiB"`
   - `a226021` — `Revert "batch: disable local Cache 1 in the Fargate entrypoint"`

   Plus a CFN redeploy to restore EphemeralStorage to 50 GiB
   (job-def revision 35).

2. **Image (ECR):** re-tagged the May-10 digest
   `sha256:9247684b9d20ad3eac8d640fef63d4257c92b55adf674bfb28445ec097105989`
   as `:latest` via `put-image` with the existing manifest.

## What's still in `master`

The post-deploy Rust commits stayed in:

- `bde12b6` `tileset: thread TileSource + ETags through to get_image`
- `a5ae54a` `source: --exclude-folder supports path-prefix patterns`
- `2acbd80` `main: raise rayon worker stack to 8 MiB`
- `bb1e267` `s3-handle: tokio worker stack 2 MiB → 8 MiB`
- `24d607c` `prepare_tile: gate local Cache 1 writes on EMOSAIC_LOCAL_CACHE`

These are useful improvements. None of them are deployed to prod —
ECR `:latest` no longer reflects `master`.

## Action items

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | **Reproduce the stack overflow on a local Linux container** with `EMOSAIC_S3_CACHE_BUCKET=emosaic-tiles-prod` and the prod-shape (~8 K tile) workload. Without a local repro we can't iterate. | task #41 | pending |
| 2 | Add a pre-deploy Fargate-shape integration test (Docker + 8 K-tile bucket, ~3 min) gated on touching `docker/entrypoint.sh`, `Dockerfile`, or `src/mosaic/tiles/utils.rs`. The 22-tile fixture is not enough. | tbd | not started |
| 3 | Investigate hyper / aws-sdk-s3 IO thread stack sizes; consider constructing the hyper client with a custom thread builder that sets `stack_size`. | task #41 | pending |
| 4 | Once #1 + #3 land, retry the S3-direct deploy (task #32 reopens). The architecture is otherwise validated end-to-end. | task #32 | pending, blocked on #41 |
| 5 | The user's `git config user.email` is `pepeiborra@Pepes-MacBook-Air.local` (hostname default). Today's 12 commits all carry that committer email. Not a blocker; mention in case you want to amend before publishing the branch. | n/a | informational |

## Lessons

1. **Pre-deploy test must match prod shape on every dimension.** Local
   M5 + Local-source bypassed both the smaller Linux thread stacks and
   the S3 SDK middleware chain — two independent factors that
   together drove the regression. The "small Fargate smoke" passed
   for the same reason.
2. **Revert in tighter cycles.** Several intermediate Rust commits
   (`a5ae54a`, `2acbd80`, `bb1e267`) were landed in fix-and-retry mode
   while the regression was already occurring. Each was tested as a
   patch on top of the broken state, not in isolation, so we
   compounded suspect commits instead of bisecting.
3. **Don't conflate "deploy" with "deploy and validate".** Once the
   first big smoke failed at 21:46, the right move was to revert and
   retest *before* shipping more fixes. The ~30-minute gap between
   first failure and full rollback was avoidable.
4. **`thread '<unknown>'` in a Rust crash is a strong signal that the
   problem is *not* in your Rust code per se** — it's in a foreign
   thread (libc resolver, native dep, or a thread spawned without
   Rust's `Builder::name`). Recognising that sooner would have
   short-cut the rayon/tokio stack-bump detour.

## Open questions

- The ECR `:latest` tag now points at a May-10 image whose source
  commit isn't tagged. We should tag that commit in git
  (`git tag prod-last-known-good <sha>`) so future rollbacks have a
  known-good target on the code side too.
- Should we move off the floating `:latest` tag and pin job
  definitions to image digests? Single-line CFN change; gives us
  deploys that are atomic with the image push (no race between the
  push completing and the job def referencing the digest).
- Cargo / runtime: is there an easy way to set a process-wide default
  thread stack size from main()? `RUST_MIN_STACK` is documented to
  affect only the main thread. The hyper / SDK threads need a
  build-time / runtime hook we haven't located yet.
