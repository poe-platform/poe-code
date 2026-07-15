---
severity: low
impact: none
comment: "Weak reassurance and its own caveat says so: the output is clean because there are no credentials to print, so it proves nothing about the logged-in case. Read with ux-utils-config-show-dumps-large-json.md and the Critical secret cluster, the honest reading is 'unverified' rather than 'positive'. Worth re-running while logged in - utils config show is cited elsewhere as the path that does redact, and confirming that would strengthen the whole redaction argument."
---

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
