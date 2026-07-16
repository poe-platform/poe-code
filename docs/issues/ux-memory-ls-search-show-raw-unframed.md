---
severity: medium
impact: polish
reproduced: y
recommendation: fix
evidence: "src/cli/commands/memory.ts:196 memory init uses resources.logger.intro/context.complete, while ls:222, search:271, lint:381 and show/write emit raw process.stdout.write output with no design-system panel"
comment: "Keep as canonical of the memory unframed-output cluster and retire the individual write filings into it: it covers ls/search/show/lint/write in one place and makes the sharpest point - init uses a design-system panel and the rest of the group does not, so the inconsistency lives within one command group. That scope makes it a single fix rather than five."
---

# UX: memory ls/search/show/lint are raw unframed (reconfirm group)

## Summary

memory ls/search/show/lint/write still dump raw text without design-system panels (except init) — reconfirm memory write raw + terse status cluster.

## Evidence

memory write/append: note.md + body dump
memory show: raw frontmatter+body
memory lint: No memory lint issues. (bare)
memory ls/search: sparse raw lines

## Why it matters

Inconsistent success language inside memory group.

## Suggested direction

Design-system cards for list/search/show/lint success.

## Severity

Medium

## Area

Memory
