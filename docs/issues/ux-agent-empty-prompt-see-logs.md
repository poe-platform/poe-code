---
severity: medium
impact: usability
comment: "The message itself is already correct; only the 'See logs' tease is wrong. So this carries no independent design decision - it is the systemic UserError-classification issue (ux-user-errors-look-like-system-failures.md) observed on 'agent \"\"'. Keep as one instance, fix centrally."
---

# UX: agent empty prompt has See logs on ValidationError

## Summary

agent "" → Prompt must not be empty + See logs — message good, chrome wrong.

## Evidence

```bash
$ poe-code agent ""
■  Error: Prompt must not be empty.
●  See logs …
```

## Why it matters

User validation should not suggest logs.

## Suggested direction

UserError without See logs.

## Severity

Medium

## Area

Agent
