# Seller IM

Seller IM commands cover pre-sale inquiry and post-sale follow-up through
Wangwang/1688 chat.

## Commands

```bash
1688 seller inquire <offerId> <message>
1688 seller chat <orderId|loginId> <message>
1688 seller messages --offer <offerId>
1688 seller messages <orderId|loginId>
1688 seller messages ... --watch
1688 inbox
```

## Local supplier questionnaire

The primary buyer flow starts directly from keyword search results: choose a
number of leading results (default 5), or check specific products, review targets
and fixed questions, then click **开始自动询盘**. The same page keeps search cards
visible and shows per-supplier conversation/progress/evidence below them. No link
copying, navigation to another page, or manual queue/start step is required.

Successful `/api/search` responses carry an `inquirySource` receipt. The server
keeps the latest 20 receipts for two hours and validates every requested offer
against its captured results before creating a job. A receipt expires on server
restart; the page must search again. Jobs persist keyword/filter provenance and
title. From-search runs are scoped to the selected job IDs, so unrelated earlier
jobs are not started. Existing product/supplier conversations are reused, not resent.
A scoped batch automatically stops when all jobs finish or need review.
Search flow can also explicitly authorize each displayed fixed clarification once.
If a textual business answer is unclear, the model selects the review branch and
the scheduler sends that question's preapproved clarification, at most once per
question. Model-written free text is never automatically sent. After another
unclear answer the batch reports review. Attachment review is never auto-replied.
Welcome/hold messages produce a `wait` decision, preserving polling without
advancing a question. Replies that precede the outgoing question's server message
are history only, so product-card welcome messages cannot answer a later question.
Re-triggering an existing reviewed conversation from search re-reads its pending
messages once, without re-sending the original inquiry or discarding confirmed facts.

Observed seller-assistant rich-text messages (360001, official assistant origin,
matching non-link richText payload and summary) are classified as text, annotated
`origin: sellerAssistant`, and sent to the model for interpretation. Platform
sample-coupon notices (389001) are auto replies and do not satisfy business questions.
Unknown/mixed cards, images or attachments remain review-only. This avoids confusing
the seller's AI reply with an attachment or claiming it is a human commitment.
The observed mobile smart-reception producer `wireless-wwpush-qcxy` uses the same
validated 360001 template. Its hold replies are text and can produce model `wait`.
The exact platform no-response notification is nonbusiness autoReply.

The local workbench's **供应商问答** view supports importing selected search
results or up to 100 offer links/IDs per batch. It asks about the exact product,
export packaging, stock, dropshipping, optional certificates/document sharing,
and special VAT invoices. It does not promise purchases or contact sellers off-site.

Configure a full Chat Completions-compatible URL, model ID, API key and 1–8
model workers in the page. `BB1688_MODEL_ENDPOINT`, `BB1688_MODEL_NAME` and
`BB1688_MODEL_KEY` can preconfigure the service. HTTPS is required except for
loopback HTTP models. Keys stay in server memory/environment, are not returned
by the API or saved in records, and are never forwarded across HTTP redirects.
Re-saving with an empty key preserves it only for the exact same endpoint.
Use **测试模型** to send a synthetic answer to the configured model without
contacting 1688 sellers. The provider must support JSON object responses.

Default mode requires approval of every outgoing message. Automatic mode requires
explicit approval of the displayed fixed questions and targets when creating jobs.
Only explicitly authorized fixed questions and fixed clarifications auto-send;
model-suggested free-text clarifications always need approval.
Human acceptance advances the current question. Images, files, cards, ambiguous
answers, unsupported model evidence and DOM messages without server IDs stop for
human review. Conclusions describe supplier claims, not verified compliance.

Each offer gets persistent state, history, message IDs, evidence and an outbox in
`<session home>/supplier-dialogue.json`. Records contain private conversations;
they are local and can be exported as CSV. Product IDs and resolved supplier IDs
are deduplicated; multiple offers from one supplier require review in the first
conversation. Existing history is baselined before the first inquiry.

One account shares the workbench CLI queue with sourcing commands. There is a
5-second minimum gap between dialogue account operations; each waiting conversation
is polled no more frequently than every 30 seconds. Round-robin scheduling keeps
other sellers progressing while replies are pending. Model analysis can overlap;
no multi-account/browser expansion is performed. These limits are local controls,
not published 1688 safe thresholds. A user-selected send budget counts the first
product link as well as texts; failed attempts are counted conservatively.

Startup runs `doctor --no-launch --json`, checks daemon status and reuses a healthy
running daemon; it starts one only when absent. Exit 3/4 pauses all
jobs, displays manual login/`--headed` recovery, and does not silently retry.
Unconfirmed sends pause all jobs and require explicit sent/not-sent reconciliation.
Restart always leaves the scheduler paused; model configuration must be supplied
again unless configured through environment variables. Day-long silence times out
for manual recovery. Manual messages or a disconnected history window require review.

`seller inquire ... --text-only` sends only question text while retaining the
offer-scoped conversation, for followups without repeated product cards.

`seller messages --inspect` opens the current account's 旺旺 conversation list
in visible Chrome and keeps it open for manual inspection until closed. An
optional `--offer` scopes it to a resolved seller. It is read-only and rejects
`--watch`. A failed seller lookup is reported without guessing a recipient.
Offer-scoped seller resolution first reads FE_GLOBALS; when that field is absent,
it uses the existing structured offer capture's supplier.loginId. Browser/risk
errors are propagated, not silently retried through another discovery method.

## Visible Chrome Plugin Transport

For direct native replies, load `extension/` in the user's normal Chrome via
`chrome://extensions` → Developer mode → Load unpacked. The workbench provides
`/extension-install.html` with the exact directory and `/extension.zip`; source
checkouts can run `pnpm extension:pack`. This transport uses Chrome's existing
login, without copying cookies or starting the CLI profile. In extension mode the
old workbench conversation copy is hidden and its CLI start routes are blocked.

Open the extension side panel, connect to the loopback service (default 4173), and
verify the buyer nickname. Existing account history requires the same nickname.
Search keywords in the side panel, select up to 100 actual search-result offers
(default 5), inspect the fixed questions/clarifications and authorize that batch.
Each resolved supplier has a visible native 旺旺 tab. Reads have at most two
workers; clicks to send are serialized, while model interpretation overlaps using
the existing model pool. This is multiple active conversations on one account,
not multiple accounts. Existing throttle, seller deduplication, scope and outbox
rules still apply. Search receipts expire after two hours or service restart.

The local extension bridge requires the fixed extension origin and a random
connection token. It permits only scoped IM read/send tasks. Page hooks capture
the requested history's sanitized business messages, never auth frames. Polling
refreshes the existing read-history request and never reloads an editable chat.
If structured capture is unavailable, native DOM messages retain only real IDs;
unidentified replies require manual review. Unsupported product identities or
page layouts stop without guessing a seller.

Clicking/typing in a bound native page or choosing takeover pauses that supplier,
without overwriting the native editor or preventing manual replies. Other suppliers
continue. Resume is explicit and establishes a new message baseline; it does not
approve a question from the user's manual conversation. Side-panel closure,
missing heartbeat, login/slider or service restart pauses automation. In-flight
unconfirmed sends require explicit sent/not-sent reconciliation. All development
browser tests use isolated pages/models and must not send to real suppliers.

`pnpm test:extension` runs the optional Chrome for Testing integration fixture;
install its browser with `pnpm exec playwright install chromium` first. It tests
five independent suppliers, parallel model analysis, native sends, manual
takeover/reply and panel-close pause. It uses neither live accounts nor model APIs.

## Safety

Sending messages contacts real suppliers. Follow `docs/SAFETY.md` before
sending agent-authored text.

## Agent Requirements

- Preserve line-delimited JSON in watch mode.
- Deduplicate messages by server-side `messageId` when available.
- Preserve `kind` and `card` fields so agents can distinguish text, offer
  cards, order cards, images, and auto replies.
- Keep order/offer scoped conversations attached to the right context.
