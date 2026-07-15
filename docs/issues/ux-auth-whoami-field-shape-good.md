---
severity: low
impact: none
comment: "Positive pattern, no code change. Duplicate of ux-auth-whoami-fields-documented-by-shape.md - identical key list, identical claim. Consolidate the pair; whichever survives should keep the point that the shape carries no secret material, since that is the reusable rule for machine output and the precedent the auth secrets cluster needs."
---

# UX: auth whoami field shape is clean (positive)

## Summary

auth whoami JSON keys: handle, name, profile_picture, user_id — clean machine shape without secrets.

## Evidence

keys: handle, name, profile_picture, user_id

## Why it matters

Positive whoami contract.

## Suggested direction

Keep; add root whoami alias separately.

## Severity

Low

## Area

Auth / positive pattern
