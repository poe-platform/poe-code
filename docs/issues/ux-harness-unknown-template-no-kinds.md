---
severity: low
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/harness.ts:568-569 throws ValidationError 'Unknown harness template \"${kind}\".' with no kind list, despite listBuiltinTemplates() being in scope at line 564; duplicate of ux-harness-new-kinds-undocumented-must-guess-demo-names.md which already carries recommendation=fix"
comment: "Contentless sixth filing of the harness kinds gap; retire into ux-harness-new-kinds-undocumented-must-guess-demo-names.md with no loss."
---

# UX: Unknown harness template no kinds

## Summary

No allow-list.

## Evidence

harness new foobar.

## Why it matters

Authors need kinds.

## Suggested direction

List kinds.

## Severity

Low

## Area

Harness
