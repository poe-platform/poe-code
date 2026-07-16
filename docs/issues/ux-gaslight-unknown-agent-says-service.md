---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- gaslight /tmp/gasplan.md --agent notreal --yes prints 'Error: Unknown service \"notreal\".' from src/sdk/spawn-core.ts:61 (also src/sdk/spawn.ts:409), while src/cli/commands/shared.ts:491 and packages/agent-spawn/src/configs/resolve-config.ts:14 already say 'Unknown agent'"
comment: "Small and contentless, but the point is real and shared: 'Unknown service' for --agent leaks an internal noun, the same class as approvals saying 'Task' for an approval (ux-approvals-missing-id-says-task-not-found-double.md). Both are an inner layer's vocabulary escaping to the surface. Fold into one domain-vocabulary pass rather than fixing per command, and list the valid agents while touching it (ux-unknown-agent-no-allow-list-or-suggestions.md)."
---

# UX: gaslight Unknown service

## Summary

Says service not agent.

## Evidence

--agent notreal.

## Why it matters

Vocabulary.

## Suggested direction

Unknown agent.

## Severity

Medium

## Area

Gaslight / naming
