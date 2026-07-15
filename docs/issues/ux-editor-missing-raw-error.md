---
severity: low-medium
impact: usability
comment: "Fourth filing of the missing-EDITOR complaint, but the only one identifying the cause: config.ts throws a bare Error, which is why the chrome is wrong downstream. That makes it the keeper - retire the other three into it, since a typed MissingEditorError fixes the presentation automatically. It also illustrates the general mechanism behind ux-user-errors-look-like-system-failures.md: bare throws become system chrome."
---

# UX: Missing EDITOR raw Error

## Summary

throw new Error Set $EDITOR.

## Evidence

config.ts.

## Why it matters

Env prerequisite.

## Suggested direction

MissingEditorError.

## Severity

Low–Medium

## Area

Editor
