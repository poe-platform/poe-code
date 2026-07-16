---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "packages/agent-gaslight/src/config.ts:8 default 'prompt: Implement'; run.ts:181 builds '${config.prompt} ${planPath}' and spawns immediately; src/cli/commands/gaslight.ts action calls runGaslight with no confirmation or dry-run preview"
comment: "Keep as canonical for the Implement-by-default problem: passing a path alone launches an implementation run against a large plan with no preview or confirmation, and --mode read does not prevent it because the Implement intent lives in gaslight's own prompt. This is the behavioral statement of what ux-gaslight-help-says-plan-to-implement.md sees in the copy and what ux-gaslight-mode-read-still-mutated-plans-dir.md proves has consequences. Its 'dry-run shows prompt only' suggestion is the cheapest safe fix."
---

# UX: gaslight <plan.md> starts Implement without confirmation

## Summary

gaslight docs/plans/32-agent-goal.md --mode read --yes begins Prompt: Implement <path> and agent starts exploring/implementing a large plan — surprise high-blast-radius action from a path alone.

## Evidence

```bash
$ poe-code gaslight docs/plans/32-agent-goal.md --mode read --yes
◇  Prompt
│     Implement docs/plans/32-agent-goal.md
# agent begins implementation exploration
```

## Why it matters

Passing a plan path should preview or require explicit implement intent; --mode read still implements via gaslight prompt.

## Suggested direction

Default prompt: Review not Implement; or require --implement; dry-run show prompt only.

## Severity

**High**

## Area

Gaslight
