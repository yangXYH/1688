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
