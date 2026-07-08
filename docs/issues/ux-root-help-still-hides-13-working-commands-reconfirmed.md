# UX: root --help still hides 13+ working commands (reconfirmed)

## Summary

Root help still lists ~18 commands ending at usage. Working but hidden: skill, memory, worktree, eval, maestro, superintendent, code-review, runtime, launch, approvals, tasks, provider, utils (13). Usage still npm run dev.

## Evidence

```bash
$ poe-code --help
Usage: npm run dev -- <command> [...args]
Commands: install…usage only
# each of skill memory worktree eval maestro superintendent code-review
# runtime launch approvals tasks provider utils --help works (exit 0)
```

## Why it matters

Reconfirm Critical discoverability failure still open.

## Suggested direction

Register all public commands on root help; displayBinaryName poe-code.

## Severity

**High**

## Area

Help / discoverability
