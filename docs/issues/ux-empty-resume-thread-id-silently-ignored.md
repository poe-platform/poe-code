---
severity: medium
impact: correctness
comment: "Another instance of the empty-flag family and a slightly worse one than most: an empty --resume-thread-id silently starts a fresh session, so a user intending to resume loses thread context with no signal at all. Fold into the empty-flag policy (ux-empty-model-flag-behavior-inconsistent.md) rather than fixing alone; the shared rule covers it."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/spawn.ts:256 forwards resumeThreadId when !== undefined, so \"\" reaches providers; packages/agent-spawn/src/spawn.ts:189 and src/providers/poe-agent.ts:742 use truthiness checks (!options.resumeThreadId), silently skipping resume; no empty-string validation exists in spawn.ts"
---

# UX: empty --resume-thread-id is silently ignored

## Summary

spawn … --resume-thread-id "" succeeds as a fresh session — empty resume id not rejected (related empty-model-flag inconsistency).

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --model haiku --resume-thread-id ""
# succeeds without resume error
```

## Why it matters

Explicit empty flags should error when present.

## Suggested direction

Reject empty --resume-thread-id when flag present.

## Severity

Medium

## Area

Spawn / flags
