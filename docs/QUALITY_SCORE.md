# Quality Score

This file tracks agent-readiness and known quality gaps. Keep it blunt and
mechanical; it is a map for improvement, not a blame document.

## Current Score

Overall: 6 / 10

## Strengths

- Clear buyer-journey command surface exists: sourcing, inquiry, cart,
  checkout, tracking, and post-sale chat.
- Commands expose JSON automatically when piped and support `--json`,
  `--pretty`, `--get`, and `--pick`.
- Real browser/session behavior is centralized under `src/session`.
- Profile-scoped daemons give agents warm browser contexts without forcing
  unrelated profiles through one global lock.
- Checkout and feedback write actions already have explicit safety protocols.
- Deterministic Vitest coverage exists for output, mtop parsing, recovery,
  page-state, inbox cards, and fixtures through `pnpm test:unit`.
- Agent map docs and generated indexes now exist.

## Gaps Blocking Higher Agent Autonomy

- `AGENTS.md` was historically long; future work should keep it short and keep
  durable detail in `docs/`.
- Generated context is heuristic and should improve as command/result types
  evolve.
- Browser/live verification is not part of the default gate and needs explicit
  manual/probe checks.
- Sourcing research fields such as repurchase rate, supplier scores, and
  service badges are not yet normalized.
- Some probe scripts are exploratory and not documented as stable workflows.
- JSON compatibility policy exists in docs but is not yet enforced by schema
  tests.

## Last Known Verification Snapshot

On 2026-10-28, `pnpm agent-verify` passed after the local web review fixes:
typecheck, 33 deterministic test suites, docs freshness, agent map, and release
metadata checks. The release check now inspects npm's actual dry-run file list
for the workbench assets and helpers. The bin helper's CRLF-sensitive import
and Windows-incompatible POSIX permission assertion were corrected.

The built tarball was extracted and its web entry served HTML/JS/CSS and
validated invalid prices. Ego-browser checks with isolated fixture CLI data
covered retained results/selections, failed-query provenance, detail comparison,
keyword/image Excel downloads, and 320–1440 px layouts. Workbook contents were
read back; embedded image XML remains covered by deterministic tests. These
checks do not establish live 1688 image-search or authentication availability.

On 2026-05-28, `pnpm agent-verify` passed:

- `pnpm typecheck`
- `pnpm test:unit` (22 files, 151 tests)
- `pnpm docs-check`
- `pnpm agent-map-check`

On 2026-05-28, full `pnpm test` failed in `tests/doctor-live.test.ts` because
the live doctor checks returned `DOCTOR_FAILED` in the current local
environment. The default agent gate uses `pnpm test:unit` to keep live checks
explicit.

## Quality Targets

- 6 / 10: short map, docs map, generated indexes, and default verification
  gate exist.
- 7 / 10: JSON contract tests cover all stable command outputs and docs-check
  runs in CI.
- 8 / 10: browser/live verification playbooks are repeatable and key mtop
  payloads have fixture-backed parsers.
- 9 / 10: sourcing research scoring, supplier-quality extraction, and
  autonomous inbox workflows have deterministic harness tests.
