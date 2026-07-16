---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "logout.ts:21 intro('logout') then loop at logout.ts:43-49 calls executeUnconfigure which re-intros at unconfigure.ts:50; `npm run dev -- logout --dry-run` printed 721 lines with nested panels 'Poe - unconfigure codex' and 'Poe - unconfigure claude-code' plus full config diffs"
comment: "Keep as canonical for the logout dry-run flood (distinct from the secret leak): a factory-reset preview nests a panel per agent with full config dumps, so the one output users most need to read before an irreversible action is the least readable. Its fix - a single summary of agents and files - is also what ux-auth-logout-no-confirmation-removes-all-agents.md needs for its confirmation gate, so build the two together."
---

# UX: logout --dry-run still opens multi unconfigure panels (reconfirmed)

## Summary

logout --dry-run still nests Poe - unconfigure goose panels and large config dumps — factory-reset dry-run noise reconfirmed.

## Evidence

logout --dry-run → ┌ Poe - unconfigure goose + large yaml dumps

## Why it matters

Reconfirm multi-panel logout dry-run.

## Suggested direction

Single summary of agents/files; redact secrets.

## Severity

**High**

## Area

Logout / dry-run
