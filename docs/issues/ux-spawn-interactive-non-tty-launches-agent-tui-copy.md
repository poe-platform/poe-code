---
severity: high
impact: usability
comment: "Keep as canonical of the --interactive non-TTY quartet: best evidence (the agent's greeting 'Hey! What would you like to work on today?' appearing in a non-TTY run), which proves the flag is honoured into an interactive path that cannot possibly work. Its fix is right and matches the in-product precedent - plan view refuses non-TTY cleanly (ux-plan-view-non-tty-requires-path-good.md). Absorbs the other three."
---

# UX: spawn --interactive non-TTY still launches agent interactive greeting

## Summary

spawn claude … --interactive on non-TTY does not fail-fast; prints agent TUI greeting Hey! What would you like to work on today? — interactive mode should refuse non-TTY or require PTY.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --model anthropic/claude-haiku-4.5 --interactive
Hey! 👋 What would you like to work on today?
```

## Why it matters

Non-TTY CI with --interactive hangs/wastes runs; should ValidationError.

## Suggested direction

--interactive requires TTY. Use without --interactive for scripts.

## Severity

**High**

## Area

Spawn / non-TTY
