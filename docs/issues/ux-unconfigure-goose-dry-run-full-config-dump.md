---
severity: medium
impact: usability
comment: "Duplicate within the dry-run flood family; retire into ux-configure-dry-run-dumps-entire-existing-agent-config.md. Its 'summarize preserved extensions' suggestion matches the canonical's 'N project entries preserved' shape - one fix, one wording."
---

# UX: unconfigure goose --dry-run dumps full config rewrite

## Summary

unconfigure goose --dry-run creates large full config.yaml + dump rather than intentional-only removal summary — dry-run flood class.

## Evidence

unconfigure goose --dry-run → full +config.yaml with many extensions.

## Why it matters

Reconfirm dry-run dump noise.

## Suggested direction

Intentional-only diff; summarize preserved extensions.

## Severity

Medium

## Area

Dry-run
