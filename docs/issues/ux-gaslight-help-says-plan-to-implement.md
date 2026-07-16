---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/gaslight.ts:312 argument help is 'Markdown plans to implement sequentially'; packages/agent-gaslight/src/config.ts:8 scaffolds 'prompt: Implement' as the default round prompt"
comment: "Keep as canonical of this pair. Sharper than it looks: the copy is not merely awkward, it accurately documents the destructive default that ux-gaslight-mode-read-still-mutated-plans-dir.md proves is real - so help is describing a behavior that should not exist. Do not fix the copy alone; that would ratify the default. Settle the behavior question (should a bare plan path imply Implement?) and let the copy follow."
---

# UX: gaslight help says plan-path is Markdown plan to implement

## Summary

gaslight --help Argument plan-path: Markdown plan to implement — hard-codes Implement intent in help; default prompt is Implement path (critical mutation class).

## Evidence

```text
Arguments:
  plan-path           Markdown plan to implement
```
Default gaslight prompt is Implement <path>.

## Why it matters

Help copy steers toward destructive Implement; conflicts with --mode read safety.

## Suggested direction

Markdown plan to run; default prompt Review/implement only with --implement or yolo.

## Severity

**High**

## Area

Gaslight / help
