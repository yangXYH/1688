# Documentation Map

This directory is the canonical knowledge base for agents and humans working on
`1688-cli`. Keep `AGENTS.md` short and put durable context here.

## Start Here

- Chrome automation user manual (中文): [`chrome-extension-guide.zh-CN.md`](chrome-extension-guide.zh-CN.md)
- Agent working principles: [`AGENT_WORKING_PRINCIPLES.md`](AGENT_WORKING_PRINCIPLES.md)
- Repository architecture: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- Default workflow: [`WORKFLOW.md`](WORKFLOW.md)
- Command catalog: [`COMMANDS.md`](COMMANDS.md)
- JSON contracts: [`JSON_CONTRACTS.md`](JSON_CONTRACTS.md)
- Safety rules: [`SAFETY.md`](SAFETY.md)
- Reliability notes: [`RELIABILITY.md`](RELIABILITY.md)
- Quality score: [`QUALITY_SCORE.md`](QUALITY_SCORE.md)
- Feature backlog: [`FEATURES.md`](FEATURES.md)
- Agent maps plan: [`AGENT_MAPS_PLAN.md`](AGENT_MAPS_PLAN.md)

## Domain Knowledge

- Specs: [`specs/`](specs/)
- Repeatable playbooks: [playbooks/](playbooks/)
- Amazon FBA sourcing playbook: [playbooks/amazon-fba-sourcing.md](playbooks/amazon-fba-sourcing.md)
- Records and postmortems: [`records/`](records/)
- Generated repository indexes: [`generated/`](generated/)
- Long-running plans: [`exec-plans/`](exec-plans/)

## Maintenance Rules

- Update command docs when command names, flags, behavior, or examples change.
- Update JSON contracts when agent-facing output shape changes.
- Update safety docs when a write action, approval boundary, login flow, or
  checkout behavior changes.
- Add or update a playbook when an agent repeats the same workflow twice.
- Run `pnpm agent-context` after changing commands, exported result
  interfaces, source layout, or tests.
- Run `pnpm agent-verify` before handoff, or record the exact blocker.
