# Web procurement review fixes

## Goal and constraints

Address all ten findings from the buyer review. Preserve existing uncommitted
work and stable CLI fields; do not log in, contact sellers, mutate carts, or
place orders during verification.

## Plan

1. Preserve results, selections, filters and provenance per mode; validate
   prices before requests. Verify failed-search and switching regressions.
2. Replace unsupported credential claims with source-labelled signals, add
   demand provenance, and unify Excel exports. Verify parsers and workbook data.
3. Match the CLI home, expose the session path, package a runnable web entry,
   and add region/inspection filters plus on-demand MOQ/SKU/tier details.
4. Fix the bin helper import failure, update docs/indexes, run focused tests,
   browser checks, build, package check, and the full agent gate.

## Decisions and evidence

- Initial working tree contains existing UI/Excel changes; build on them.
- Reproduced `tests/fix-bin-mode.test.ts` import SyntaxError before edits.
- Current web home defaults to `.runtime`, unlike CLI `~/.1688`.
- Official deep-certification terms distinguish factory and business inspection:
  https://terms.alicdn.com/legal-agreement/terms/suit_bu1_b2b/suit_bu1_b2b201802011744_81460.html
  No public field contract was found for the search payload flags. Display
  their source names and explicitly avoid treating them as membership proof.
- Keep search fast: fetch selected product details on explicit user action,
  rather than automatically enriching every result.

## Progress

- [x] Read project map, relevant specs/contracts/release playbook; reproduce gate failure.
- [x] Implement all ten fixes and regression coverage.
- [x] Update English/Chinese READMEs, command/JSON docs, changelog, quality
  snapshot, and generated context.
- [x] Complete verification and record results.

## Final behavior

- Per-mode results, selections, query snapshots and keyword filters survive
  tab switches. Failed requests label retained data as the last successful
  result and include its original conditions in the page and export.
- Prices validate inline and in the local API before CLI invocation.
- Inspection labels expose payload flag sources without membership claims.
  Existing CLI keys remain stable; provenance fields are additive.
- All modes export image-enabled Excel, with demand source/unknown period and
  a search-provenance worksheet. Image failures are reported.
- Web and CLI default to the same home; UI/status/startup expose the path.
  Old `.runtime` sessions remain available via explicit `BB1688_HOME`.
- The npm archive includes the separate `1688-ui` bin and every web/export
  helper. `release-check` now checks npm's actual archive selection.
- Province/city/inspection filters and selected-offer procurement comparison
  expose MOQ, mixed MOQ, tiers, SKU prices and stock on demand (up to 5).
- Bin-mode script import and direct invocation work on Windows; POSIX syscall
  coverage remains active on Windows and actual mode assertions run on POSIX.

## Verification (2026-10-28)

- `pnpm build` passed.
- `pnpm agent-context` refreshed generated JSON and test indexes.
- `pnpm agent-verify` passed: typecheck; 33 suites / 204 tests; docs-check;
  agent-map-check; release-check (including actual npm dry-run packlist).
- `npm pack --dry-run --json --ignore-scripts`: 198 files; includes all three
  web assets, three web helper scripts, and `dist/session/paths.js`.
- Created and extracted a real npm tarball under ignored `work/`; its web bin
  served HTML/JS/CSS/health and rejected inverted prices in Chinese. With no
  home override, startup resolved `C:\Users\YANG\.1688` as expected. No global
  install or publish was performed.
- Ego-browser, isolated fake CLI: price error blocks submission, search and
  select-all persist across all modes, failed-search labels retain the old
  query, MOQ/tier/SKU comparison renders, keyword and image exports download
  as `.xlsx`. Read both workbooks back and verified headers and query source.
- Browser widths 1440, 1024, 768, 390 and 320 px: no horizontal overflow or
  clipped filter/export controls. Checks used semantic snapshots and computed
  layout, without claiming screenshot-based visual verification.
- Image embedding and missing-image reporting checked through workbook XML
  tests. Live 1688 image search, login and changing account state were not
  exercised; fixture checks do not prove live-service availability.

## Export failure follow-up (2026-10-28)

- Reproduced the buyer's screenshot on the actual loopback service: a
  13-column export returned 400 `导出数据无效。`, while the previous 11-column
  format returned 200. `/api/health` returned only `{ok:true}`. The live Node
  process (PID 29436, port 4173) started at 22:11, before the previous fixes.
  The API remained in memory while static files changed on disk.
- Added export schema negotiation through `/api/health`; old processes now
  produce an actionable restart message. Retain results/selection, accept
  already-open 13-column pages, and clear prior errors when retrying export.
- Regression coverage includes a full 20-row workbook, an old server, retry
  after update, and schema mismatch errors. `pnpm agent-context`, JS syntax
  checks and `pnpm agent-verify` passed (33 suites / 207 tests).
- Automatic review initially rejected stopping the old process (`blocked by
  policy`). The user then explicitly approved restarting only this web server.
  Confirmed no login flow was active, stopped PID 29436, and started updated
  PID 34212 on the same port with `BB1688_HOME=E:\project\1688\.runtime`.
  Login data and the daemon were not reset or stopped.
- The actual restarted service reports export schema 2. Posted 20 test rows
  without a schema version, matching the already-open screenshot page: HTTP
  200; loaded the returned Excel and verified 20 product rows, demand-source
  and period columns, and the search-provenance worksheet. No page refresh is
  needed for that existing page to retry export and retain its real selection.

## Result-limit choices follow-up (2026-10-28)

- Added 20/30/50/100/500/1000 choices to keyword/best-selling and image forms.
  The local API passes up to 1000 to both CLI commands and accepts 1000 Excel
  rows. Keyword CLI requests now allow 1000, using at most 17 sequential pages
  with existing delay/dedup/early-stop behavior. Large web keyword requests
  allow 330 seconds for the CLI subprocess.
- The choices are upper limits. Image search still uses its single platform
  response; incomplete result counts are explicitly shown rather than padded.
- `pnpm build`, `pnpm agent-context`, and `pnpm agent-verify` passed: 33 suites /
  218 tests, typecheck, generated docs, agent map, and release/packlist checks.
  Tests cover every option reaching both CLI commands, the 1000-row workbook,
  the export upper boundary, and counts below the requested maximum.
- Reloaded the CLI daemon (PID 39072) and restarted the web server (PID 28496)
  on port 4173, keeping `BB1688_HOME=E:\project\1688\.runtime`. Confirmed the
  served HTML contains both six-option lists; posted 1000 test rows to the
  real local export service, received HTTP 200, and loaded 1000 product rows.
  No live 1000-item search or account write was executed.
- The initial runtime diagnostic `node dist/cli.js doctor --no-launch --json`
  exited 1 (`DOCTOR_FAILED`): missing Playwright Chromium cache at
  `C:\Users\YANG\AppData\Local\ms-playwright`; Node v25.2.1 also printed a
  `UV_HANDLE_CLOSING` assertion on exit. The existing browser was healthy and
  daemon reload succeeded. No browser install/reset was performed; this is
  separate from the passing deterministic agent gate.

## Empty export fields follow-up (2026-10-29)

- Inspected the supplied 20-product workbook. Repurchase rate was empty for
  every product; period was only `上游未提供统计周期`. Province/city had 18
  populated rows and remain. Removed only the two unavailable-only columns.
- Product export now selects populated columns from the selected rows, keeps
  partial data and true zero values, and keeps the image column first. Image
  downloads still use the original input column; widths and data shift with
  their headers. The 13-column API request shape remains compatible.
- Created a cleaned copy under ignored `work/empty-export-cleanup/outputs/`.
  Artifact Tool import/render exposed an empty-shared-string import issue,
  so native XML values were used for verification and the native image parts
  were preserved. The final file retains all 20 rows and 20 in-cell pictures;
  every ZIP part except the product sheet is byte-identical to the source,
  including source metadata, original export timestamp, styles, images and
  rich-value relationships. Reviewed before/after renderings and checked every
  retained cell against the original values.
- Added regressions for empty/unknown columns, partial values, zero values,
  period/repurchase values when present, and image/link alignment after column
  removal. `pnpm agent-context` and `pnpm agent-verify` passed: 34 suites /
  228 tests, typecheck, docs, agent map and release checks.
- Restarted only the web server (PID 25808), preserving `.runtime` and the
  daemon/login state. The actual export API returned HTTP 200 with both empty
  fields omitted; existing pages can export without a refresh.
