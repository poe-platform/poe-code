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
