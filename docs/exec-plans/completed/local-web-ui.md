# Local Web UI for 1688 Sourcing

## Goal

Add a Chinese local browser interface to the existing CLI without changing its
search or JSON contracts. Keep all commands read-only: keyword search, image
search, best-selling sort, product links, image previews, and CSV export.

## Decisions

- Use a small Node HTTP server and static HTML/CSS/JS; add no runtime package.
- Bind to `127.0.0.1` and reuse the current `BB1688_HOME` profile.
- Invoke only fixed CLI commands through `spawn()` with argument arrays.
- Describe the best-selling view as keyword results sorted by 1688's
  best-selling order, not as a platform-wide official category ranking.
- Allow explicit user-triggered QR login; keep seller contact, cart, and
  checkout outside this UI.
- Stop the profile daemon before interactive login so it releases the browser
  lock. Login automatically starts the daemon again after success.
- Display the current login QR in the UI as well as opening a visible browser;
  serve only the current flow's QR over a fixed local endpoint with no caching.
- Parse structured CLI errors from stderr and preserve the login failure in the
  UI rather than overwriting it with an unrelated account-status error.

## Progress

- [x] Confirm actual CLI options and logged-in session.
- [x] Implement local API server and Chinese dashboard.
- [x] Add start instructions and package script.
- [x] Build, start on loopback, and inspect the page in ego-browser.

## Verification

- `pnpm build`
- `GET /api/status` reports the existing logged-in profile and reachable daemon.
- Open `http://127.0.0.1:4173` in ego-browser; the account status shows connected,
  and the image/keyword tabs switch correctly.
- `page.screenshot()` timed out in Ego Lite, but the semantic page snapshot and
  in-browser tab interactions completed successfully.

## QR Login Follow-up (2026-10-28)

- Diagnosed the failed login action: stderr returned `LOCK_BUSY` because the
  existing daemon still owned the profile browser lock.
- Added daemon shutdown before login, inline current-flow QR display, stderr
  error parsing, and preservation of login errors in the frontend.
- `node --check` passed for the server and frontend; `pnpm build` passed.
- In the real browser, clicked the login button and accepted its existing
  re-login confirmation. The daemon released the profile and the live QR image
  loaded successfully (`complete === true`, `naturalWidth > 0`). Handed the page
  to the user for scanning; account authentication awaits their phone approval.
- `pnpm agent-verify` is not green: typecheck passed and 29 unit suites / 187
  tests passed, but `tests/fix-bin-mode.test.ts` could not import the unchanged
  `scripts/fix_bin_mode.mjs` (`SyntaxError: Invalid or unexpected token`).
  `docs-check`, `agent-map-check`, and `release-check` passed when run separately.
