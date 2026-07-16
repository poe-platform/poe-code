---
severity: medium
impact: usability
comment: "One of four filings of the --interactive non-TTY problem; consolidate into ux-spawn-interactive-non-tty-launches-agent-tui-copy.md, which states the core defect best. Its distinct half (bare output with no panel) is a consequence of the same root: the flag is not refused, so output escapes the design system."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:239 interactive branch has no process.stdin.isTTY guard (only resolveSpawnMode at spawn.ts:489 checks TTY) and packages/agent-spawn/src/spawn-interactive.ts:119-132 uses stdio inherit, so agent output bypasses design-system panel; duplicate of ux-spawn-interactive-non-tty-launches-agent-tui-copy.md"
---

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
