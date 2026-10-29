# Image search: collect and export more matches

## Goal and constraints

Use the supplied suitcase image to collect up to 1,000 1688 image-search
results and provide an Excel workbook with product links and images. Preserve
the distinction between image-search matches and verified identical products.
Do not infer pagination support without observing the platform, and do not
pad results or silently substitute keyword-search recommendations.

## Plan and progress

- [x] Review existing image-search capture, contracts, and export behavior.
- [x] Probe the live image-search page and observe scroll-triggered page 2.
- [x] Implement bounded scrolling, deduplication and tests.
- [x] Run the live search and verify the workbook; record the gate blocker.

## Decisions and evidence

- Before this change, image search captured one platform response and `--max`
  only truncated it. The updated implementation collects scroll-triggered batches.
- Keyword pagination cannot be reused without confirming the image-search
  page's controls, request method, and page-context behavior.
- Existing local workbench can export offer links and image-enabled workbooks.
- The sandbox proxy failed initially; an authorized network run succeeded.
  The image page requests `imageOfferSearchService` with `beginPage=2` after
  scrolling. Two runs collected 720 distinct results; the next batch timed out,
  so platform exhaustion is not established. The workbook has 720 rows and
  embedded images, with no image download failures.
- Make capture failures explicit rather than treating a timeout, a login
  redirect or a verification challenge as a successful search with no items.

## Verification

Focused image-search, web UI and export tests passed (24 tests). `pnpm
agent-verify` was blocked by Windows EPERM creating the web-server test
fixture symlink; 33 suites and 222 tests passed before that failure.

Pre-push verification on 2026-10-29 passed: `pnpm agent-context`,
`pnpm agent-verify` (34 suites / 239 tests, typecheck, docs freshness, agent
map and release checks), `pnpm build`, and `git diff --check`. The earlier
fixture symlink failure did not recur. Updated the JSON contract to describe
scroll-triggered batches and distinguish initial capture failure from a
later-batch timeout. Local probes, buyer search results and exported workbooks
under `outputs/` are excluded from this commit. No live search was rerun for
this pre-push check.
