# UX: utils config show when logged out is clean without secrets (positive)

## Summary

utils config show with empty global and no env overrides shows project ralph/runtime config only — no secrets when logged out.

## Evidence

Global (empty); Project ralph.plan_directory + runtime.from_template; no sk-/Bearer.

## Why it matters

Positive clean config show when no credentials.

## Suggested direction

Keep; still redact if secrets present when logged in.

## Severity

Low

## Area

Utils / positive pattern
