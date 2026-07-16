---
severity: medium
impact: none
reproduced: y
recommendation: no-fix
evidence: "`npm run dev -- goal` and `npm run dev -- chat` both print 'Unknown command'; no goal/chat command registered in src/cli/program.ts and no packages/agent-goal exists, while docs/plans/32-agent-goal.md:30-47 documents them; but docs/plans/32-agent-goal.md:1-4 frontmatter already declares 'kind: plan', README.md/help never advertise the commands, and this duplicates ux-goal-chat-acp-commands-missing.md"
comment: "Duplicate of ux-goal-chat-acp-commands-missing.md; consolidate. This is the better-argued of the two and its framing is right: the defect is docs/plans running ahead of the product without 'planned' markers, so the fix is marking them rather than building commands. Worth tempering though - plans are design documents by nature and their readers are contributors rather than end users, so the false-expectation risk is smaller than for README or help."
---

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
