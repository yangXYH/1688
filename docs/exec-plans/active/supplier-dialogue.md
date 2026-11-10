# Supplier dialogue workbench

Goal: implement the sourcing questionnaire with model-backed reply interpretation
and multiple independently progressing supplier conversations.

Constraints: preserve CLI JSON compatibility; require approval for fixed-question
automation and individual approval for arbitrary text; do not infer purchases,
verified compliance or off-platform contact. Development tests use isolated fixtures.

Implementation complete:
- Persistent per-offer questionnaire, evidence, message IDs and outbox.
- Independent conversation scheduling and bounded model workers; existing CLI
  transport shares the account queue. New and existing suppliers alternate.
- Search receipts validate targets and retain provenance. Scoped batches reuse
  existing conversations and cannot restart unrelated jobs.
- Fixed clarifications are authorized separately and limited to once per question.
  Arbitrary model output, attachments and unsupported evidence require review.
- Greeting/hold replies produce wait, without advancing the current question.
  Server ordering prevents earlier welcome messages from answering a later question.
- Known seller-assistant text templates retain their origin; platform notices and
  unsupported mixed cards do not count as business answers.
- Offer-scoped followups use --text-only. Read-only --inspect supports visible
  conversation inspection, without guessing sellers after failed resolution.
- Startup reuses healthy daemons and accepts installed system Chrome. Login/risk
  failures pause work. Uncertain sends require explicit reconciliation.
- Model credentials remain process-memory only. Restart always leaves work paused.

Verification:
- Focused model, scheduler, seller parser/identity and web routing/UI tests pass.
- Isolated installed-Chrome fixtures cover search-triggered authorization, automatic
  job creation, native conversation state, CSV export and responsive layouts.
- The final default gate passed 40 suites / 293 tests, typecheck, generated docs,
  agent map and npm archive checks. Build passed.
- Runtime account identifiers, seller names, message IDs and conversation receipts
  are private local records and are not included in this public implementation note.

Current transport: the visible Chrome extension supersedes the copied workbench
chat for native replies. Earlier live batches were paused before extension
development. No tests restart those batches or contact real sellers.
See [chrome-extension.md](chrome-extension.md) for design and browser verification,
and [the user manual](../../chrome-extension-guide.zh-CN.md) for setup and operation.
