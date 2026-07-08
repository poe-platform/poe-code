# UX: Plan docs advertise goal/chat commands that do not exist yet

## Summary

Plan content (e.g. agent-goal plan) documents `poe-code goal …` and `poe-code chat` slash surfaces, but CLI returns Unknown command for goal and chat. Users reading plans or README-adjacent docs may try them.

## Evidence

```bash
$ poe-code goal
■  Unknown command: goal
$ poe-code chat
■  Unknown command: chat
```
docs/plans/32-agent-goal.md documents goal create/get/run and /goal.

## Why it matters

Docs/plans ahead of product without "planned" markers cause false expectations.

## Suggested direction

Mark unimplemented commands as planned in plan docs; or implement stubs that say not shipped.

## Severity

Medium

## Area

Docs / CLI sync
