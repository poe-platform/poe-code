# UX: spawn --interactive prints bare agent TUI text without design-system panel

## Summary

spawn … --interactive / -i in non-TTY still runs and prints bare agent text (ok / Hey!) without Poe - spawn panel framing — interactive flag does not fail non-TTY and bypasses design system.

## Evidence

```bash
$ poe-code spawn claude "say only: ok" --mode read --model haiku -i
ok
# no ┌ Poe - spawn panel
```

## Why it matters

Non-TTY -i should error or stream framed; bare output loses identity.

## Suggested direction

Reject -i without TTY; or wrap output in design-system stream.

## Severity

Medium

## Area

Spawn
