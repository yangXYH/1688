# Architecture

`1688-cli` is a TypeScript command-line tool for Alibaba 1688 buyer workflows:
sourcing, seller IM, cart, checkout, order tracking, and logistics follow-up.
It uses Playwright with a persistent browser profile, a daemon for warm
sessions, and stable JSON output for agents.

## Layer Map

```text
src/cli.ts
  -> src/commands
  -> src/session
  -> src/daemon
  -> src/io
  -> src/auth
  -> src/util
tests -> src/*
docs/generated -> scripts/generate_agent_context.mjs
```

## Layer Responsibilities

`src/cli.ts` owns the public command surface: command names, options,
arguments, and lazy imports.

`src/commands` owns user-visible behavior for each command. A command usually
contains:

- option parsing / validation
- `execute(ctx, args)` for daemon-dispatched work
- `run(opts)` for CLI invocation
- human rendering through `emit({ human, data })`

`src/session` owns browser automation primitives: Playwright context setup,
mtop/response capture, locators, recovery, locking, page-state detection,
navigation guards, artifacts, and timing helpers.

`src/daemon` owns the long-lived background process, request protocol,
client/server dispatch, and inter-command throttling.

`src/io` owns output compatibility, JSON flags, prompts, and structured
`CliError` behavior.

`src/auth` owns login/session verification and cookie handling.

`src/util` owns small shared helpers.

`tests` owns deterministic Vitest coverage. Live/browser flows should be
guarded or documented when they cannot be deterministic.

`docs` owns durable agent-readable knowledge. `docs/generated/*` is generated
by `scripts/generate_agent_context.mjs`.

## Dependency Rules

- CLI routing may import commands lazily, but command modules should not import
  `src/cli.ts`.
- Command modules may use `src/session`, `src/daemon/dispatch` indirectly,
  `src/io`, `src/auth`, and `src/util`.
- `src/session` should not depend on command modules, except shared types only
  when there is no cleaner local session type.
- `src/io` should stay browser-free and command-agnostic.
- `src/daemon` should depend on command executors through explicit dispatch
  wiring, not dynamic ad-hoc imports from arbitrary modules.
- JSON-facing result interfaces should live near the owning command and be
  documented in `docs/JSON_CONTRACTS.md` when stable for agents.

## Major Domains

- Sourcing: `search`, `similar`, `image-search`, `offer`.
- Pre-sale seller IM: `seller inquire`, `seller messages --offer`.
- Cart: `cart list`, `cart add`, `cart remove`.
- Checkout: `checkout prepare`, `checkout confirm`.
- Order tracking: `order list`, `order get`, `order logistics`, `shipped`,
  `stuck`, `fake-shipped`, `seller-history`.
- Post-sale seller IM: `seller chat`, `seller messages <orderId|loginId>`.
- Account/session: `login`, `logout`, `whoami`, `doctor`, `daemon`, `serve`.

## Browser And Session Model

- The tool uses persistent browser profiles under `~/.1688`.
- Each daemon is bound to one profile, reuses that profile's browser context,
  and adds jitter between commands.
- Commands should handle login redirects, risk-control pages, and browser
  closure through structured exit codes.
- `--headed` is the manual escape hatch for slider verification.
- Browser probes under `scripts/probe-*.mjs` are exploratory tools, not stable
  verification gates.

## Visible Chrome Extension

`extension/` is an optional MV3 transport for the user's logged-in Chrome.
`worker.js` owns visible search/supplier tabs and scoped native DOM actions;
`page-hook.js` captures only IM history responses and refreshes the existing
read-history request without reloading editable chat pages. `content.js`
stops a supplier's automation on trusted user interaction or an existing draft.
The side panel controls scoped batches; native 旺旺 remains the reply editor.

`scripts/extension-bridge.mjs` maps the questionnaire's existing read/inquiry
operations to finite tasks, authenticated by extension origin and connection token.
The local server still owns model credentials, evidence, budgets and persistent
outbox. Extension mode bypasses the CLI-owned browser/profile; native Chrome cookies
are never exported. Missing heartbeat or side-panel closure pauses execution.
See `extension/README.md` and `docs/specs/seller-im.md` for installation/recovery.

## Generated Context

- Run `pnpm agent-context` after changing commands, source layout, tests, or
  exported JSON result interfaces.
- Generated files live under `docs/generated`.
- Do not hand-edit generated files; change
  `scripts/generate_agent_context.mjs` instead.

## Verification Surfaces

- Type safety: `pnpm typecheck`
- Deterministic tests: `pnpm test:unit`
- Full test suite including live doctor checks: `pnpm test`
- Agent indexes: `pnpm agent-context`
- Generated docs freshness: `pnpm docs-check`
- Agent map structure: `pnpm agent-map-check`
- Default gate: `pnpm agent-verify`
