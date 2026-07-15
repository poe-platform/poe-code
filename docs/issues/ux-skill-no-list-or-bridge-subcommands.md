---
severity: high
impact: capability-gap
comment: "Keep as canonical of this pair (covers list and bridge). The list gap is the substantive one; the bridge gap is weaker, since bridging happens automatically during spawn (ux-skill-bridge-failure-lists-paths-good.md) and may not need a command at all - verify before scheduling. Its own hedge ('bridge may exist elsewhere') is appropriately honest."
---

# UX: skill has no list/bridge subcommands (users expect inventory)

## Summary

skill list and skill bridge are Unknown command — skill only install/configure/unconfigure. Users cannot list installed skills or bridge between agents from CLI.

## Evidence

```bash
$ poe-code skill list
■  Unknown command: list
$ poe-code skill bridge
■  Unknown command: bridge
```
skill --help: install, configure, unconfigure only.

## Why it matters

Discoverability of installed skills is missing; bridge may exist elsewhere but not under skill.

## Suggested direction

Add skill list; document or expose bridge if supported; fix npm run dev in errors.

## Severity

**High**

## Area

Skills / discoverability
