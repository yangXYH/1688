# Visible Chrome automation extension

User goal: operate the user's logged-in Chrome 1688 pages, visibly search and
chat across several suppliers, and allow native manual replies/takeover. The
user explicitly requested an extension transport instead of the CLI-owned
headless profile; that specific request supersedes the repository's default
CLI-only runtime route for this feature.

Plan:
1. Add a narrowly authenticated local extension bridge and reuse questionnaire/model state.
2. Add an MV3 side panel, visible per-supplier tabs, structured IM capture, and manual takeover.
3. Verify transport cancellation, duplicate-send protection, identity checks and mocked browser flows.
4. Package an unpacked extension/ZIP, update docs and run agent-verify.
5. Open Chrome extension management; loading into the user's normal profile requires Chrome's native Load unpacked UI.

Constraints: no cookies/password export, no remote executable code, no silent login,
no background-profile sends, no inferred purchases. Model API key remains local
server memory. Existing live batches paused before implementation. Extension
starts paused, requires visible side-panel authorization and matching buyer account.

Design: stable extension ID from public manifest key; bridge endpoints accept only
that extension origin and a per-connection token. Poll/result tasks are finite,
bounded and never re-delivered after uncertain execution. Side panel closure or
lost heartbeat pauses automation. Per-job takeover stops automation before native
typing/send, preserving real editable chat tabs. In-flight uncertain sends require
native reconciliation. Search results and seller identity come from Chrome pages;
local backend retains scoped batches, budgets, fixed questions and model workers.

Progress:
- Implemented the stable-ID MV3 extension, native search/results, five-supplier
  tabs, read-only structured history capture/refresh and native editor sends.
- Reused the model pool, fixed-question authorization, evidence, budget and outbox.
- Added authenticated origin/token bridge with finite operation IDs; no cookie
  export or model keys in the extension. Restarts preserve extension mode/manual
  ownership but remain paused. Side-panel closure/heartbeat loss pauses work.
- Trusted user interaction or an existing draft takes over a supplier; native
  manual replies remain functional. No polling reloads editable chat pages.
- Added installer page, allowlisted ZIP packaging and npm archive verification.

Verification:
- `pnpm agent-verify` passed with 293 deterministic tests (40 suites), including
  restart-mode preservation, plus typecheck, generated docs, map and npm archive checks.
- `pnpm test:extension` passed against loaded MV3 in Chrome for Testing:
  5 unique native supplier tabs, 15 automated native messages (link + two questions
  each), 5 local mock model calls with peak concurrency 2, no chat-page reloads,
  manual draft preservation/native send, other jobs continue, panel-close pause.
- All browser/model traffic in the integration test was isolated fixtures.
  No extension-based messages have been sent to real sellers.
- `pnpm build` and `pnpm extension:pack` passed; ZIP path is
  `outputs/1688-chrome-extension.zip`.

Installation boundary: normal Chrome requires Developer mode / Load unpacked in
its extension manager. We cannot claim user-profile installation or live-account
compatibility before that step. The user must login/handle sliders in that Chrome.
Existing live conversation records are retained and paused.

Delivery: installer HTML, extension-info and ZIP endpoints return 200. The ZIP
contains exactly the 9 allowlisted extension files and no hardcoded model
credential. Normal Chrome installation uses the native extensions manager.
The repository includes a full Chinese user manual linked from both READMEs and
the documentation map. Local exports, account data and private operation receipts
are excluded from publication.
