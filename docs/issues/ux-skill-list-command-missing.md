---
severity: high
impact: capability-gap
comment: "One of two filings of the missing skill inventory; consolidate with ux-skill-no-list-or-bridge-subcommands.md. Real capability gap and worth High: the product installs skills into agent-specific directories that differ per agent (ux-skill-configure-goose-writes-dot-agents-skills.md) and then provides no way to see what is installed - so the one command that would make the layout discoverable is absent. Its npm run dev half belongs to the identity cluster."
---

# UX: skill list is unknown command

## Summary

skill list → Unknown command: list + npm run dev recovery. skill only has install/configure/unconfigure; no list/ls of installed skills.

## Evidence

```bash
$ poe-code skill list
■  Unknown command: list
└  Run npm run dev -- skill --help
```

## Why it matters

Users cannot discover installed skills; help recovery uses npm run dev.

## Suggested direction

skill ls/list; displayBinaryName recovery.

## Severity

**High**

## Area

Skills
