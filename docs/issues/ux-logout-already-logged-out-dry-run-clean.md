---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/logout.ts:56-70 dry-run branch returns before deleteConfig (line 73) and emits only 'Already logged out.'; loaders receive readOnly: flags.dryRun. Positive no-defect note, nothing to fix."
comment: "Positive but narrow, and it should not be read as reassurance: logout --dry-run is clean only because there is nothing to remove when logged out. The same command with credentials present is the Critical secret leak (ux-logout-dry-run-still-prints-secrets-reconfirmed.md), which the file itself concedes. Its value is as a boundary case for the regression tests that fix should ship: dry-run must stay clean in both states."
---

# UX: logout --dry-run when already logged out is clean (positive)

## Summary

logout --dry-run when not logged in: Already logged out; no filesystem changes — clean, no secrets.

## Evidence

●  Already logged out.
●  # no filesystem changes

## Why it matters

Positive logout no-op dry-run when logged out (contrast secret leak when logged in).

## Suggested direction

Keep; still redact when logged in dry-run shows diffs.

## Severity

Low

## Area

Auth / positive pattern
