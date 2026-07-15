---
severity: high
impact: usability
comment: "Important and correctly High despite thin evidence: a success check-mark beside 'API Error: 400' is worse than unhelpful because it teaches users that glyphs carry no meaning, undermining every other status signal in the CLI. Root of a family including ux-spawn-invalid-model-shows-success-then-failure.md, ux-successful-spawn-still-uses-checkmark-for-agent-text.md and ux-acp-stream-uses-success-glyph-for-partial-text.md. Likely cause: the agent output line is rendered with a fixed glyph regardless of payload - fix at that layer."
---

# UX: Failures rendered with success checkmarks

## Summary

Pipeline/gaslight use ✓ next to API errors.

## Evidence

✓ agent: API Error: 400…

## Why it matters

Success glyphs train ignore.

## Suggested direction

Failure glyphs for non-success.

## Severity

**High**

## Area

Pipeline / trust
