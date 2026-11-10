# Safety

This tool operates a real 1688 buyer account. Some commands read public or
account data; others contact sellers, mutate cart state, submit feedback, or
place orders. Treat write actions as explicit user-authorized operations.

## Exit Codes

| Code | Meaning | Agent behavior |
|---:|---|---|
| 0 | Success | Continue. |
| 2 | Bad invocation | Fix arguments or report the bad input. |
| 3 | Not logged in / session expired | Tell the user to run `1688 login`; do not loop. |
| 4 | Risk control / slider verification | Tell the user to rerun once with `--headed`; do not silently retry. |
| 5 | Another 1688 command is running for the selected profile | Wait only if the task naturally allows it; otherwise report lock busy. |
| 6 | Chromium missing | Report dependency issue. |
| 7 | Login wait timeout | Report timeout. |
| 8 | Login finished but cookies missing | Report login cookie issue. |
| 9 | Network error | Report or retry only when safe and bounded. |
| 130 | User canceled | Stop. |

## Login And Logout

- `1688 login` opens a user-interactive QR/browser flow. Only run it when the
  user explicitly asks to log in.
- In non-interactive sessions, `1688 login` saves a QR PNG to
  `~/.1688/login-qr.png` and prints `QR saved as PNG: <path>` on stderr.
  Surface that file/path to the user and wait for the command to exit.
- Do not open the raw QR URL in a browser.
- `1688 logout --yes` destroys the cached session. Do not pass `--yes` without
  explicit current-turn confirmation.

## Risk Control

- If exit code `4` appears, tell the user to rerun the same command once with
  `--headed`.
- The user must solve the slider manually.
- Do not silently retry the same blocked command.

## Seller Contact

These commands contact real sellers:

```bash
1688 seller inquire <offerId> <message>
1688 seller chat <orderId|loginId> <message>
```

Before sending, show the message and target context unless the user has already
given an explicit current-turn send instruction.

## Local Questionnaire Approval

The local supplier questionnaire implements the same seller-contact boundary:
default per-message approval, or explicit authorization for the displayed fixed
questions and selected offers in automatic mode. Search flow optionally also
authorizes the displayed fixed clarification per question once; it does not
authorize arbitrary model-generated wording. Generated free-text clarification
always requires approval. Creating jobs alone does not start the scheduler.
The development agent must not activate live jobs or contact real sellers merely
to test this feature. No order placement or off-site contact is included.

## Visible Chrome Plugin

The optional plugin runs in the user's logged-in Chrome, not the CLI profile.
Authorize exact search-result targets and displayed fixed wording in its side
panel before starting. Arbitrary model text still requires individual approval.
Clicking or typing in a native conversation takes over that supplier; existing
drafts must never be overwritten. The plugin does not reload chat pages to poll.
Side-panel closure or bridge heartbeat loss pauses the scheduler. Unconfirmed
in-flight sends remain uncertain until explicitly reconciled in the native chat.
Resolve login/verification in the current Chrome page; never loop around it.
Do not export Chrome cookies or store model API keys in the plugin package.

## Cart Mutations

These commands mutate buyer cart state:

```bash
1688 cart add <offerId> --sku <skuId> --qty N
1688 cart remove <cartId>
```

For agent use, show the offer/SKU/quantity or cart row being changed and run
only after the user approves that action.

## Checkout Protocol

`1688 checkout confirm` places a real order. It does not pay automatically, but
it commits the buyer to the seller.

Agent protocol:

1. Run `1688 checkout prepare <cartIds...>`.
2. Show the full preview: total, items, address, seller, and cart IDs.
3. Wait for explicit current-turn approval such as "yes, place it" or
   "下单吧".
4. Run `1688 checkout confirm <cartIds...> --agent`.
5. Report the final order ID and URL.

Never run `--agent` without this prepare plus approval cycle. Never infer
authorization from older messages.

## Feedback Submission

`1688 feedback "<message>"` prepares a GitHub issue URL. That is safe by
default.

`1688 feedback "<message>" --submit` posts publicly through `gh`. Do not add
`--submit` unless the user explicitly asks to submit/post the issue.

## Update Awareness

`1688 doctor --no-launch --json` reports version information. Any JSON-mode
command may also emit an update notice on stderr.

Rules:

- In an interactive session, ask once before running the printed global install
  command.
- In non-interactive loops, do not upgrade automatically.
- After an approved package update, run `1688 daemon reload`.
