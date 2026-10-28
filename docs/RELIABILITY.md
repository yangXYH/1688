# Reliability

`1688-cli` depends on a live website, browser automation, mtop responses, and a
real logged-in buyer session. Reliability work should make failures explicit
and recoverable for agents.

## Daemon

Each daemon routes commands for one profile through one persistent Chromium
context. Different profiles use different daemon processes, locks, sockets or
named pipes, pid/version/log files, state files, and persistent browser
directories.

Benefits:

- Saves Chrome cold-start time.
- Keeps one continuous logged-in session per profile.
- Adds inter-command jitter.
- Allows different profiles to run at the same time without sharing one
  process lock.

Use `1688 daemon start` near the beginning of a session with multiple 1688
commands. Use `1688 daemon start --profile <name>` for a non-default profile.
The daemon auto-stops after inactivity. Run `1688 daemon reload --profile
<name>` after package updates or after manually resolving profile-specific
browser issues.

`login`, `logout`, and `doctor` stay inline because they need interactive UI,
browser windows, or environment checks. `login --profile <name>` can
auto-start that profile daemon after the login state is available.

## Watch Mode

`1688 seller messages ... --watch` is designed to stay alive.

- It prints a baseline line to stderr.
- It emits one JSON object to stdout for each newly-arrived message.
- History is not re-emitted.
- Deduplication uses server-side `messageId` when present.
- It exits cleanly on SIGINT.

Agent loops should parse stdout line by line and should not assume the process
will exit by itself.

## Browser Recovery

Commands should detect and report:

- login redirects
- risk-control / slider pages
- closed browser windows
- empty mtop captures
- network failures

Use structured `CliError` exit codes so agents can choose the next safe step.

## Probes And Fixtures

Probe scripts under `scripts/probe-*.mjs` are useful for discovering page
behavior, selectors, and mtop payloads. They are not stable automated tests.

Stable behavior belongs in `tests/` with fixtures where possible.

## Local Workbench Updates

Keyword pagination must stay in the same page/search context. The current
pagination region (`data-spm="pagination"`) uses CSS-module classes such as
`nextArrow--<hash>` and `arrowDisabled--<hash>`; do not match the generated hash.
Keep the legacy `.fui-next` fallback and exclude disabled arrows. Missing or
unclickable controls must be reported as a pagination stop, not a claim that
the platform has exhausted results. Later-page login and verification errors
still require the normal manual recovery, without silent retries.

The local server reads static web assets from disk on each request, but loads
its API and Excel helpers when the Node process starts. After updating source
or installing a newer package, restart the web server as well as rebuilding
the CLI when needed. Keep the same `BB1688_HOME` override to retain the active
session; older source workbenches defaulted to the project's `.runtime`.

`GET /api/health` reports `exportSchemaVersion: 2` for the 13-column Excel
format. Before exporting, the page checks this field. A pre-upgrade process
without the capability returns an actionable restart message, preserving
results and selection so export can be retried without refreshing the page.
The updated API also accepts already-open 13-column pages that omit the
optional request schema version. Explicit incompatible versions return 409.

## Live-Service Boundaries

`pnpm test:unit` is the deterministic default. `pnpm test` also runs live
doctor checks and may depend on local browser/session state. Browser or
account-mutating checks should be explicit, bounded, and documented in the
final response when they cannot be run.
