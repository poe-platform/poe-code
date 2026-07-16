---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/harness.ts:569 throws ValidationError('Unknown harness template \"kind\".') with no kind list; line 101 documents argument only as 'Built-in template kind' despite listBuiltinTemplates() being available at line 565"
comment: "Duplicate within the kinds cluster; retire into ux-harness-new-kinds-undocumented-must-guess-demo-names.md. It does correctly identify the two places the list must appear - help and the unknown-kind error - which is the fix shape."
---

# UX: harness new unknown kind does not list templates

## Summary

harness new not-a-kind foo: Unknown harness template "not-a-kind" — no list of valid kinds; harness new --help also omits kinds.

## Evidence

Unknown harness template "not-a-kind".
harness new help: kind = Built-in template kind (no choices).

## Why it matters

Discoverability of templates is broken.

## Suggested direction

List kinds on error and in help (coverage-demo, …).

## Severity

Medium

## Area

Harness
