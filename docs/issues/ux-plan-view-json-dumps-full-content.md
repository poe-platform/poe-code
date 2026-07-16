---
severity: medium
impact: usability
comment: "One of three filings of the plan view JSON content flood; consolidate into ux-plan-view-json-embeds-full-content-flood.md. All three agree on the fix shape: metadata by default, body behind an opt-in flag."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/plan.ts:637 emits 'content: markdown' in plan view JSON; view command at plan.ts:604-651 registers only --kind and --output, no --include-content/--meta flag"
---

# UX: plan view --output json dumps full markdown content

## Summary

plan view --output json includes entire content string of the plan body — huge payload for scripts that only need metadata.

## Evidence

JSON has kind, path, title, detail, content: full markdown…

## Why it matters

Metadata-only consumers pay full content cost; no --meta flag.

## Suggested direction

Default json without content; --include-content for body.

## Severity

Medium

## Area

Plan
