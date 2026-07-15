---
severity: medium
impact: usability
comment: "Good observation and a real data problem rather than presentation: poe-code's own traces store the agent name as the title while claude's store the prompt, so our traces are the least identifiable in our own listing - with several runs, every row reads 'claude-code'. Its fix is right (store a prompt snippet). Note the tension with ux-traces-json-includes-full-prompt-titles.md, which wants prompt titles truncated for privacy: a short snippet serves both."
---

# UX: traces --source poe-code titles are just agent names

## Summary

poe-code source traces show title pi / claude-code / cursor without user prompt — less useful than claude source titles that show prompts.

## Evidence

traces --source poe-code → Title column: pi, claude-code, cursor.

## Why it matters

Hard to find a run among many agent-name-only titles.

## Suggested direction

Store prompt snippet as title for poe-code traces.

## Severity

Medium

## Area

Traces
