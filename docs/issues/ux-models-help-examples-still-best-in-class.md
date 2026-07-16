---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:299-307 shows the Examples block with provider, feature, endpoint, view, search, model, since flags exactly as described; positive note, not a defect, and duplicates ux-models-help-examples-are-excellent.md"
comment: "Reconfirm duplicate of ux-models-help-examples-are-excellent.md; retire into it. Its enumerated example list (provider, feature, endpoint, view, search, model, since) is the concrete inventory worth carrying into the template work."
---

# UX: models --help Examples remain best-in-class (positive reconfirm)

## Summary

models --help Examples block shows provider, feature, endpoint, view, search, model, since — reconfirm best-in-class help pattern for other commands to copy.

## Evidence

Examples: models --provider anthropic; --feature reasoning --since 3mo; …

## Why it matters

Positive template for spawn/configure help.

## Suggested direction

Copy pattern to spawn/configure/install.

## Severity

Low

## Area

Help / positive pattern
