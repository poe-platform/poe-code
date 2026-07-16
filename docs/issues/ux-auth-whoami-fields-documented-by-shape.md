---
severity: low
impact: none
comment: "Duplicate of ux-auth-whoami-field-shape-good.md (same four keys, same conclusion); retire one. Its only actionable residue - document the key contract in help - is small enough to fold into the whoami documentation issue rather than tracked separately."
reproduced: n
recommendation: no-fix
evidence: "src/sdk/credentials.ts:7-10 declares user_id/handle/name/profile_picture and lines 112-118 validate them; positive no-defect note duplicating ux-auth-whoami-field-shape-good.md"
---

# UX: auth whoami returns handle/name/user_id/profile_picture (positive)

## Summary

auth whoami JSON keys: handle, name, profile_picture, user_id — stable machine shape.

## Evidence

whoami keys: handle, name, profile_picture, user_id

## Why it matters

Positive machine identity contract.

## Suggested direction

Document in help; keep stable.

## Severity

Low

## Area

Auth / positive pattern
