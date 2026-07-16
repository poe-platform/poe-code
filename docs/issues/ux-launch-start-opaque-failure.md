---
severity: medium
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/launch.ts:48 declares variadic argument([command...]); probe 'npm run dev -- --dry-run launch start myproc echo hi' printed 'Dry run: would start managed process myproc.' with exit 0, no separator needed"
comment: "Contentless but names a real argv problem: 'launch start myproc echo hi' without -- fails with 'failed to start' rather than explaining the separator is required. Merge with the failure half of ux-launch-start-triggers-turbo-monorepo-build.md; the fix is to validate argv and echo what was received (per ux-launch-start-via-npm-run-dev-confuses-argv.md), not to explain turbo."
---

# UX: launch start opaque failure

## Summary

Missing -- → failed to start.

## Evidence

launch start myproc echo hi.

## Why it matters

Usage looks crash.

## Suggested direction

Validate argv.

## Severity

Medium

## Area

Launch
