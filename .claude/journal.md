# Journal

## 2026-05-16 (late) — Floating year-slider on mobile

**Commits** (branch `worktree-year-slider-floating`, 2 ahead of `origin/master`, rebased clean)
- `eb10551` fix(widget): float year-filter at fixed viewport position on mobile
- `9a678d8` tests(widget): Bug #7 floating year-filter regression suite

**Deploys**
- `s3://emosaic-admin-prod/mosaic-widget.css` + `.js` updated. CSS etag `ddc56a7c7b379799a916f413cff81437`, JS etag `f9ec7c59501454243f61ee103d986440`.
- All 35 per-mosaic dirs under `s3://emosaic-tiles-prod/mosaics/<uuid>/` synced with the same files — safe this time because the change is HTML-structure-compatible (see hazard analysis below).
- CloudFront invalidation `I1F0R3MSRKJ6I19RYCSO5Z4UXG` on `E2KW8FQIKWXD1D` for `/mosaic-widget.{css,js}` + `/mosaics/*/mosaic-widget.{css,js}`. Verified all three encoding variants (`identity`, `gzip`, `br`) return the new ETag on both the admin-root URL and a per-mosaic URL.
- ECR `prod-emosaic:latest` rebuild + push *(in progress / digest TBD)* so future Batch renders bake the same CSS/JS into per-mosaic bundles.

### The bug

On mobile the year-filter slider was anchored to the rendered image's bottom-right by `positionYearFilter()`, which `applyTransform()` re-invoked on every pan/zoom. The function computed `imageRect.right - containerRect.left - filter.offsetWidth` — i.e. the filter's screen position was a function of the zoom-container's transform. Result: as the user panned the mosaic the filter scrolled off-screen with it; pinch-zooming sent it 1000+ px out of view.

### The fix

On mobile, anchor the filter to the viewport with `position: fixed` + bottom/right (plus `env(safe-area-inset-*, 0px)`). Shrink `positionYearFilter()` to a near-no-op that just clears any legacy inline `left/top/display:none` from the old code path — preserves backward compatibility with pre-fix per-mosaic HTML that may have had inline styles persisted from a prior visit. Also stack the year display under the slider (was `position: absolute; top: -26px`) and restore a visible translucent background (was `background: transparent` on mobile, which was fine when overlaid on the image but unreadable when floating over arbitrary content).

The selector signatures (`.year-filter-container.image-positioned`, `.year-slider-wrapper`, `.year-display`) are unchanged — the CSS retargets existing classes that every per-mosaic HTML already has. Hence safe to deploy to all per-mosaic dirs without an HTML rewrite.

### Regression test

`tests/widget/specs/year-filter-floating.spec.ts` — three mobile-only checks:
1. Computed `getComputedStyle().position === 'fixed'` on the filter container.
2. After programmatically translating the zoom-container (`transform: translate(-200px, -150px) scale(1.5)`), the filter's `getBoundingClientRect()` is unchanged within 1px. This is the actual symptom check — the bug was *positional*, not stylistic.
3. The filter sits inside the viewport, anchored close to bottom-right (`vw - right < 40px`, `vh - bottom < 40px`).

All 6 mobile-test cases pass (mobile-chromium ×3 + mobile-webkit ×3); 6 desktop cases skip via `test.skip(!projectName.startsWith('mobile-'))`. The existing `year-filter-mask.spec.ts` (Bug #6) still passes 4/4 — no regression to the Safari mask fix.

### Things learnt

**Per-mosaic asset deploys — when is it safe?** Earlier today's `3eff963` Safari mask fix could NOT be pushed to per-mosaic dirs because the new CSS required a new HTML structure. Today's floating-slider fix CAN be pushed everywhere because it retargets pre-existing class names with no HTML changes. Decision rule: if the CSS diff adds/removes selectors that match new elements, restrict to admin-root and require mosaic regeneration. If the diff only restyles existing elements, it's safe to push everywhere.

**Compatibility-friendly JS rewrites.** The old `positionYearFilter()` would set `style.left`, `style.top`, and sometimes `style.display = 'none'`. A clean rewrite to "do nothing" would leave those inline styles in place forever in returning visitors' browsers — even with `position: fixed` in the new CSS, an inline `left: 240px` from a prior visit would still apply. The fix is to actively *clear* those properties on first invocation. Mantra: when replacing imperative DOM mutation with declarative CSS, you have to undo the imperative side-effects, not just stop emitting them.

**Brotli verification was clean today.** The May-15 brotli-stickiness gotcha didn't recur — all three encoding variants on the new etag returned `Miss from cloudfront` (= just-purged) immediately after the invalidation went `InProgress`. Suggests the gotcha is sporadic, not deterministic. Worth re-checking even when previous deploys behaved.

**Symlinked node_modules can be unreliable.** First attempt to run the widget Playwright suite from the worktree used `ln -s ../tests/widget/node_modules` — Playwright resolved fine, but `pngjs` (needed by `year-filter-mask.spec.ts`) was missing from the source tree's node_modules. Just `rm node_modules && npm install` in the worktree's tests/widget was faster than diagnosing the cross-worktree resolution. Lesson: when a worktree needs JS deps, `npm install` in the worktree directly; symlinks are a foot-gun for transitive resolution.

**xargs -I substitution has a length limit on macOS.** A heredoc-style `xargs -I {} bash -c "long command with {} multiple times"` hit `xargs: command line cannot be assembled, too long` for an inner command that worked fine standalone. Workaround: extract the inner command into a small helper script in `$CLAUDE_JOB_DIR` and `xargs -I UUID helper.sh UUID args...`. Cleaner and bypasses the limit.

**The "deploy to prod" scope question is worth asking.** The deploy involved two distinct moves: (1) immediate user-visible fix via asset sync + invalidation, (2) container rebuild so future renders preserve the fix. `AskUserQuestion` with three concrete scopes (admin-root only / assets+container / assets only) took 5 seconds and avoided either silently doing less (admin-root, leaving 35 mosaics broken) or silently doing more (rebuild + push without authorization).

---

## 2026-05-16 — Safari year-slider fix + CloudFront SSM consolidation

**Commits**
- `3eff963` fix(widget): SVG-attribute mask for year filter — fixes Safari
- `d317bc8` infra(cloudfront): SSM parameter for customer-facing distribution ID *(branch `worktree-cfn-ssm-fix`, not yet merged or deployed)*

**Deploys**
- ECR `prod-emosaic:latest` → digest `sha256:0cba8de42c61460ccb2606b8f85ab3c040005ea2323152d38c606aa6e53a63c6` (was `sha256:106618fb…`).
- `s3://emosaic-admin-prod/mosaic-widget.css` updated; CloudFront invalidation `IC9JRIVY055LV7ER4459R0G2MS` on `E2KW8FQIKWXD1D` for `/mosaic-widget.css*`; brotli + no-encoding variants both `Miss from cloudfront` with matching ETag.
- Per-mosaic dirs under `s3://emosaic-tiles-prod/mosaics/<uuid>/` deliberately NOT updated — see hazard below.

### Safari year-slider

**The bug.** Commit `163a740` (year-filter perf rewrite) used a `<div class="year-dim-overlay">` with CSS `mask-image: url(#year-mask)` + `-webkit-mask-image: url(#year-mask)` referencing an inline `<mask>` element inside a 0×0 SVG. Safari (desktop + iOS) silently ignored both declarations — the overlay painted as a uniformly opaque dim rectangle with zero cutouts and the year slider was visually inert. JS state, DOM, and computed style were identical to Chromium; only painted pixels diverged.

**The fix.** Replace the `<div>` + CSS mask with an inline `<svg id="year-dim-overlay">` containing `<rect mask="url(#year-mask)">`. SVG-attribute masking IS supported in WebKit. No JS logic change — the same `getYearMaskInner()` cache rewrites the `<mask>` content per slider step. The 80% scrub-perf win from `163a740` is preserved.

**The regression test.** `tests/widget/specs/year-filter-mask.spec.ts` engages the filter, takes a 8×8 `page.screenshot({clip})` at one match-tile center and one non-match-tile center, decodes via `pngjs`, computes BT.601 luma, asserts delta > 30. With the fix, delta ≈ 100; with the bug, delta = 0. Negative-tested by stashing the fix and confirming `desktop-webkit` fails (delta 0) while `desktop-chromium` passes (delta > 30) — the test catches the bug precisely.

**Two stacked WebKit bugs identified.** Primary: CSS `mask-image: url(#fragment)` doesn't resolve to inline `<mask>`. Secondary (would bite us on a data-URL fallback): WebKit's `mask-image` defaults to `mask-mode: alpha`, not luminance. The widget's mask uses luminance semantics (white = visible, black = hole), so a naive data-URL fix would need explicit `mask-mode: luminance`. Both bugs are sidestepped by SVG-attribute masking, which defaults to luminance per spec.

**Per-mosaic HTML hazard.** This fix changes the dim-overlay HTML structure. The new CSS dropped `background` and `mask-image`, so it requires the new HTML to render anything visible. Existing per-mosaic HTML at `s3://emosaic-tiles-prod/mosaics/<uuid>/` was generated by the previous binary and still has the old structure. Pushing the new CSS to per-mosaic dirs would regress Chrome (overlay would paint nothing). Existing mosaics need to be **regenerated** via admin UI to pick up the fix — the new binary writes a consistent new bundle.

### CloudFront SSM consolidation (groundwork; not yet deployed)

**Setup.** Earlier today I'd patched `prod-job-completed` and `prod-set-main-mosaic` Lambdas via `aws lambda update-function-configuration` to fix a `CLOUDFRONT_DISTRIBUTION_ID` drift (pointed at an unaliased distribution `E10P0LC8CZZQG4` instead of the customer-facing `E2KW8FQIKWXD1D`). That patch is in-memory only; next `deploy-cloud.sh` run reverts it because CFN re-resolves the `!ImportValue`.

**CFN-Critic agent review corrected my framing.** `E10P0LC8CZZQG4` is NOT orphaned — it's a real second distribution serving the admin-UI bucket via the raw `*.cloudfront.net` URL (used for dev/RC access). `deploy-admin-ui.sh:76-80` has an explicit comment that BOTH distributions need invalidation. So the bug isn't "delete the duplicate" — it's that the CFN export points at the wrong-of-two for the customer-facing invalidation path. `E2KW8FQIKWXD1D` itself is hand-managed entirely outside CFN, hardcoded in three shell files (`Makefile:23`, `deploy-admin-ui.sh:85,98`, `deploy-cloud.sh:707`).

**Recommended fix (Option D).** SSM Parameter Store as the single source of truth. `deploy-cloud.sh` writes `/emosaic/${env}/main-cloudfront-id` after computing the value; the Lambdas read it via `!Sub '{{resolve:ssm:/emosaic/${Environment}/main-cloudfront-id}}'`. Beats parameterizing the admin-ui stack (which would still leave three hardcoded copies) and beats runtime lookup via `ListDistributions` (extra API call per cold start).

**Implementation (commit `d317bc8`).**
- `aws-backend/cloudformation/job-handler.yaml:37` and `phase3-enhancements.yaml:84` — both Lambdas switched from `!ImportValue ${env}-emosaic-admin-cloudfront-id` to `!Sub '{{resolve:ssm:/emosaic/${Environment}/main-cloudfront-id}}'`.
- `aws-backend/deploy-cloud.sh` — writes the SSM param for both branches (no-custom-domain envs use `${MAIN_DISTRIBUTION_ID:-E2KW8FQIKWXD1D}`; custom-domain envs use `$ADMIN_DISTRIBUTION_ID` from the stack output). The custom-domain branch was a scope extension on top of the original plan — without it, non-prod envs would hard-fail at next deploy because `{{resolve:ssm:...}}` errors if the param doesn't exist.
- `aws-backend/cloudformation/admin-ui-infrastructure.yaml` — dropped only the `Export:` sub-field on `CloudFrontDistributionId`, not the entire Output. The Output is still queried by `deploy-admin-ui.sh:82` via `describe-stacks` for the secondary-invalidation path. Deleting it would have broken admin-UI deploys.
- Stretch: `Makefile:23` and `deploy-admin-ui.sh:75-100` read the SSM param with the literal as fallback (one source of truth across all four call sites).

**To activate.** `git checkout d317bc8` (or merge `worktree-cfn-ssm-fix` into working branch) and run `AWS_PROFILE=admin ./aws-backend/deploy-cloud.sh`. That writes the SSM param AND updates the two Lambda env vars on next CFN convergence. In-memory Lambda patch becomes redundant after that.

### Things learnt

**WebKit / Safari CSS quirks.**
- `mask-image: url(#fragment)` referencing an in-document `<mask>` element does NOT work in WebKit. Safari supports SVG-attribute masking (`<rect mask="url(#id)">`) just fine; only the CSS-property pathway is broken. Reach for SVG-attribute masking when targeting cross-engine.
- `mask-image` defaults to `mask-mode: match-source`, which for SVG data URIs resolves to `mask-mode: alpha` in WebKit (not luminance). Data-URL masks with luminance semantics need explicit `mask-mode: luminance` + `-webkit-mask-mode: luminance`.
- Element/computed-style assertions can't catch paint-time bugs. The Safari year-slider bug had identical DOM and identical `getComputedStyle()` between engines; only the rendered pixels diverged. Pixel-level assertions (via `page.screenshot()` clip + `pngjs`) are needed to catch this class of bug. The earlier tooltip bug (`f39c98b`) had the same shape — `document.elementFromPoint()` over a tile center turned out to be the only programmatic detector.

**Tooling gotchas.**
- `EnterWorktree` defaults to `worktree.baseRef: fresh` (= branches from `origin/<default-branch>`). When local HEAD is ahead of origin, you get a stale base. Fix: `~/.claude/settings.json` (or `.claude/settings.json` for repo-local) with `{"worktree": {"baseRef": "head"}}`. Alternatively, bypass with `git worktree add path -b branch HEAD` then `EnterWorktree({path: ...})`.
- Background-session guard refuses Write/Edit to the shared checkout. If you actually need to edit a gitignored file (like `.claude/settings.json`) in the shared checkout, you have to hand it to the user.
- Claude Code auto-mode classifier blocks production deploys even after user approval via `AskUserQuestion`, because it reads visible text not structured answers. Surface the deploy intention in chat text first, then run.
- Playwright `npm test` regenerates the fixture via `globalSetup`. Running `npx playwright test` directly skips that — useful for some experiments, but if you've reverted source files for a negative test you MUST run the rebuild explicitly first.
- `aws lambda update-function-configuration --environment 'Variables={…}'` is a full replace, NOT a merge. If you only want to change one var, read the full set first and re-set them all together. (Today this turned out to be a non-issue because I'd done that prior, but the danger is real.)
- `aws s3 cp` doesn't always invalidate the brotli variant on CloudFront; verify with `curl -sI -H "Accept-Encoding: gzip, deflate, br"`. Today's CSS deploy was clean (both variants `Miss from cloudfront` with matching ETag); the brotli-stickiness from earlier today didn't recur.

**Team-agent patterns.**
- Two agents in independent investigation > one agent. Mask-Hunter and Event-Hunter converged on the same root cause from opposite ends (CSS-side vs JS-side), and the convergence was strong evidence the diagnosis was right. Each found something the other missed (Mask-Hunter the secondary `mask-mode` trap; Event-Hunter the clean JS-pipeline proof).
- Agents that go idle without filing their deliverable can be SendMessage'd to elicit findings — they don't always wake up on their own.
- Critic agents earn their keep: CFN-Critic corrected my "E10P0LC8CZZQG4 is orphaned" framing using `deploy-admin-ui.sh` comments I hadn't checked. If I'd implemented the original plan (parameterize the stack, delete the export, delete the Output) I'd have broken admin-UI deploys.

**Per-mosaic widget asset deploys.**
- A widget fix that only changes CSS (e.g. earlier today's `contain: paint` drop) can safely be pushed to all per-mosaic dirs — the existing HTML still works with the new CSS.
- A widget fix that changes the HTML structure (today's SVG-overlay refactor) MUST NOT be pushed to per-mosaic dirs without also regenerating each mosaic's HTML. Mismatched CSS+HTML across the per-mosaic dirs causes regressions across all existing mosaics. Default to admin-prod-root-only and trigger regeneration for existing mosaics.

### Outstanding / not deployed

- `worktree-cfn-ssm-fix` branch at `d317bc8` — local only, awaiting merge + deploy.
- Worktree dir `.claude/worktrees/cfn-ssm-fix` kept on disk; remove with `git worktree remove` once the commit is merged into the working line.
- Existing mosaics still serving the broken year-slider in Safari. Each needs regeneration via admin UI to pick up the Safari fix.
