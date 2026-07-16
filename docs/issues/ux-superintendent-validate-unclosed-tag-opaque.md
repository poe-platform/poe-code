---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- superintendent validate docs/plans/32-agent-goal.md prints '- Error: Unclosed tag' with no line/column; thrown at packages/toolcraft-design/src/components/template.ts:207 which omits position info"
comment: "Contentless duplicate within the Unclosed-tag trio; retire into ux-superintendent-validate-unclosed-tag.md. Its distinct ask is the useful half and survives the merge: if a parse error is genuinely the right answer, it must carry a line and column - 'Unclosed tag' with no location is unactionable even for a real superintendent doc."
---

# UX: superintendent validate Unclosed tag

## Summary

No location.

## Evidence

validate 32-agent-goal.

## Why it matters

Can't find tag.

## Suggested direction

Line/column.

## Severity

Medium

## Area

Superintendent
