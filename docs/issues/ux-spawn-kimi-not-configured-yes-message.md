---
severity: high
impact: usability
comment: "Fair: 'Kimi is not configured via poe. Pass --yes to proceed without prompting' answers a configuration problem with a flag that suppresses prompting, which does not obviously address the stated cause - and ux-spawn-kimi-acp-internal-error-stack.md shows that following the advice produces an internal error, so the recovery actively leads users into a worse failure. That connection is the important one: the message is not merely unclear, it is wrong. Its suggested replacement (point at configure kimi) is right."
reproduced: n
recommendation: no-fix
evidence: "Already fixed: commit 946f67ea7 'fix(spawn): remove implicit Poe requirements' (2026-07-12, ancestor of HEAD) deleted `${target.label} is not configured via poe. Pass --yes to proceed without prompting.` from src/sdk/spawn.ts; rg finds the string only under docs/issues, and src/cli/commands/spawn-command.test.ts:3140 now asserts 'spawns without checking provider configuration'."
---

# UX: spawn kimi not configured message mentions --yes oddly

## Summary

spawn kimi without configure: Kimi is not configured via poe. Pass --yes to proceed without prompting — unclear what --yes does (skip configure? force spawn?).

## Evidence

```bash
$ poe-code spawn kimi "say only: ok" --mode read
■  Kimi is not configured via poe. Pass --yes to proceed without prompting.
```

## Why it matters

Recovery path unclear; should say configure kimi or install.

## Suggested direction

Run poe-code configure kimi; or --yes meaning proceed unconfigured documented.

## Severity

**High**

## Area

Spawn / kimi
