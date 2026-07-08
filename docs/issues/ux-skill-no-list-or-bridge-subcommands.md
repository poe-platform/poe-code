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
