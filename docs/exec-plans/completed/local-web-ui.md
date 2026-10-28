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

## UI Refresh (2026-10-28)

- Reworked the page with a light sidebar, forest-green accents, larger working
  text, consistent inline SVG icons, a focused search panel, and responsive
  keyword/image views. Added useful empty-state actions and keyword shortcuts.
- Improved product cards with full-image containment, a currency prefix,
  selected-card feedback, a list view, select-all, and export selection counts.
- Added skeleton loading feedback and a dedicated account-connection notice.
  Local connection badges and sidebar session text now reflect actual state.
- Added accessible image-source tab relationships and arrow-key navigation.
- Found a server error-handling issue during browser review: serialized route
  promises were returned without awaiting them inside the outer try/catch.
  Awaiting them now returns an HTTP error instead of an unhandled rejection.
- Build and JavaScript syntax checks passed. All 80 HTML IDs are unique and all
  63 static JS DOM references resolve. A rejected image request returned HTTP
  400 and the following health request returned HTTP 200.
- Browser checks passed for keyword shortcuts, image navigation, source tabs,
  best-selling mode, card/list controls, and loading feedback. Detached DOM
  checks verified safe card escaping, price display, and partial/all-selection
  feedback without inserting sample products into the visible interface.
- Both keyword and image layouts fit widths of 1440, 1024, 768, 390, and 320
  pixels without horizontal overflow. The browser was left open on the updated
  keyword view after restoring device metrics.
- Screenshot capture is unreliable in this Ego Lite session: surface capture
  times out and non-surface capture returns an unusable image. Page snapshots,
  computed layout checks, and real control interactions were used instead.
- The full agent gate still has the same unchanged `fix-bin-mode.test.ts`
  import error recorded above; 29 suites / 187 tests and typecheck passed.

## Clipboard Image Paste (2026-10-28)

- The image-search upload panel now accepts image data from the browser paste
  event while the local-file source is active. Pasted images use the existing
  JPEG/PNG/WebP and 8 MB validation, preview, and search flow.
- The local preview uses an object URL, so the page's image CSP includes
  `blob:` to let the selected or pasted image render in the preview.
- Updated the upload prompt and README so users know to copy an image and press
  `Ctrl+V` while the image-search page is open.
