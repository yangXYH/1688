# Repair keyword pagination beyond the first 60 offers

## Goal and constraints

Fix the buyer's real 1000-limit search returning only 60 offers. Diagnose the
actual page control/request before changing behavior. Use the CLI for live
sourcing, preserve normal pacing/session context and deduplication, and stop
on login or verification challenges. Preserve unrelated uncommitted changes.

## Plan

1. Inspect the real pagination control and why the current selector fails.
2. Fix advancing and capture matching; expose actionable partial-result
   reasons instead of silently treating a broken paginator as the result end.
3. Add deterministic multi-page regressions (including 17 pages), update
   contracts/docs, build and pass the agent gate.
4. Verify a real search returns more than 60 unique offers, then update the
   running daemon and local web service without resetting login data.

## Progress and evidence

- [x] Read search/capture/locator implementations and risk-control playbooks.
- [x] Startup doctor: healthy logged-in Chrome/daemon, but exit 1 because the
  Playwright Chromium cache is missing; Node 25 also printed the previously
  observed UV_HANDLE_CLOSING assertion. No install/reset performed.
- [x] Diagnose and fix the real paginator.
- [x] Add regressions, update docs and pass verification.
- [x] Live multi-page check and runtime update.

## Findings and decisions

- The real page exposes 34 pages. The old `.fui-arrow.fui-next` selector found
  none of its current CSS-module `nextArrow--Q9NJPp33` controls under the
  `data-spm="pagination"` region. Match the stable prefix, exclude
  `arrowDisabled--*`, and retain the old selector as a fallback.
- Reproduced 60 results before the fix with CLI exit 0. After the selector
  repair a real `search 旅行拉杆箱 --max 100 --json` returned 100 unique IDs.
- Preserve current delays/session continuity. Permit a bounded second page
  budget for duplicates rather than stopping after the nominal raw-item count.
- Add `pagination` metadata so a failed next control/capture is distinguishable
  from a short last page. Later-page challenges fail with existing exit 3/4.
- Focused regressions passed: 17-page/1000-ID collection, duplicate pages,
  missing and blocked controls, capture timeout, verification challenge,
  short last page and no-new-ID stop, plus the UI's concrete reason message.

## Final verification

- `pnpm build`, `pnpm typecheck`, `pnpm agent-context` passed.
- `pnpm agent-verify` passed: 34 suites / 226 tests, typecheck, docs freshness,
  agent map and release checks. `git diff --check` passed.
- Real CLI before repair: 60 offers, exit 0; the page offered 34 pages.
- Real CLI after repair, `旅行拉杆箱 --max 100`: 100 unique offers, exit 0.
- Real CLI after final changes, `旅行拉杆箱 --max 1000`: 1000 unique offers;
  17 captured pages; `stopReason=limit_reached`; exit 0. Saved local evidence
  under ignored `work/pagination-fix/`, without adding buyer data to fixtures.
- The inline CLI check automatically resumed a fresh daemon from the repaired
  build (PID 14388). Existing web API already allows 1000 and passes through
  the new pagination metadata; no further web-process restart was required.
- Confirmed the actual running `POST /api/search` also traverses pages:
  `max=100` returned HTTP 200, 100 unique offers and 2 captured pages, with
  `stopReason=limit_reached`. The existing page can simply search again.
- No login reset, seller contact, cart/order changes or risk-control retries.
