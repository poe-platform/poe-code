---
severity: medium
impact: usability
comment: "Duplicate of ux-launch-missing-process-system-chrome.md, which already covers restart alongside logs; retire into it. No distinct content."
reproduced: y
recommendation: no-fix
evidence: "packages/process-launcher/src/launcher.ts:227 throws plain Error 'Managed process \"<id>\" was not found.'; src/cli/bootstrap.ts:74-80 prints 'Error: ...' plus 'See logs at ...' for non-UserError"
---

# UX: launch restart missing process has See logs

## Summary

launch restart missing: Managed process was not found + See logs.

## Evidence

■  Error: Managed process "missing" was not found.
●  See logs …

## Why it matters

UserError without logs; suggest launch status.

## Suggested direction

UserError.

## Severity

Medium

## Area

Launch
