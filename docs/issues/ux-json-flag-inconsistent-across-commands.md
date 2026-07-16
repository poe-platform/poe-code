---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "--json exists only on tasks (src/cli/commands/tasks.ts:66,80,120) and traces (src/cli/commands/traces.ts:86); models list (src/cli/commands/models.ts:265-273), provider (src/cli/commands/provider.ts:54-56) and usage list (src/cli/commands/usage.ts:186-187) declare no --json, while auth whoami always prints JSON (src/cli/commands/auth.ts:39,150)"
comment: "Contentless, but it names the umbrella for a real family: ux-auth-status-no-json-flag.md, ux-provider-list-no-json-flag.md, ux-usage-list-no-json-flag.md and ux-pipeline-validate-no-json-flag.md all ask the same question per command. Promote it to the policy issue - which commands are scriptable, and is --json the mechanism or a sibling command (whoami being the precedent) - and link the four to it. Needs the actual inventory pasted in to be actionable."
---

# UX: --json inconsistent

## Summary

Some commands only.

## Evidence

models/provider lack.

## Why it matters

Scripting.

## Suggested direction

Product rule.

## Severity

Medium

## Area

Scripting
