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
