---
severity: medium
impact: none
reproduced: y
recommendation: no-fix
evidence: "rg '.command(\"(goal|chat|acp)\")' over src+packages returns nothing; `npm run dev -- goal` prints 'Unknown command: goal'; but README.md/help never advertise them, only docs/plans/32-agent-goal.md; duplicate of ux-plan-docs-advertise-goal-and-chat-commands-missing.md"
comment: "Legitimate docs-versus-product drift: docs/plans describes a goal CLI that is not registered, and chat/acp are absent. The fix is to align the two rather than necessarily build the commands. Worth naming the audit's own bias here: plans are design documents, not promises, so 'plans mention it' is weak evidence of a user-facing gap unless README or help also advertise it - check that before scheduling. ux-plan-docs-advertise-goal-and-chat-commands-missing.md covers the same ground."
---

# UX: goal/chat/acp commands missing despite product plans

## Summary

goal, chat, acp are Unknown command — agent-goal plan documents goal CLI but commands not registered; chat/acp absent.

## Evidence

goal/chat/acp → Unknown command: … npm run dev help.

## Why it matters

Docs/plans promise surfaces that do not exist yet — discoverability gap.

## Suggested direction

Ship commands or hide from docs; fix binary name in errors.

## Severity

Medium

## Area

Help / product gaps
