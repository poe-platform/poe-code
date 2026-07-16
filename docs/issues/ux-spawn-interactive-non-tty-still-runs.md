---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:239-265 calls spawnInteractive with no process.stdin.isTTY gate; the isTTY guard at spawn.ts:489 covers --mode only; packages/agent-spawn/src/spawn-interactive.ts:119-132 sets tty:true and inherits stdio without checking for a real TTY - so --interactive is honoured, not dropped. Duplicate of ux-spawn-interactive-non-tty-launches-agent-tui-copy.md (reproduced: y, recommendation: fix), which carries the same fix."
comment: "Duplicate within the --interactive quartet; retire into ux-spawn-interactive-non-tty-launches-agent-tui-copy.md. Its 'flag ignored or partially applied' hedge is honest and is the real question: whether --interactive is silently dropped or partially honoured decides between the empty-flag family and the non-TTY family."
---

# UX: spawn --interactive non-TTY still runs non-interactively

## Summary

spawn … --interactive without TTY still produces agent output (not a clear "requires TTY" failure) — flag ignored or partially applied.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --model haiku --interactive
# still gets agent text response in non-TTY
```

## Why it matters

--interactive should require TTY or fail clearly.

## Suggested direction

Error if --interactive && !TTY; or strip flag with warning.

## Severity

Medium

## Area

Spawn / interactive
