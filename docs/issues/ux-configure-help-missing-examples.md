---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/configure.ts:72-85 defines description/options with no addHelpText; only models.ts:299 and plan.ts have Examples. `npm run dev -- configure --help` output ends at Options with no Examples section."
comment: "Reasonable, but High is hard to justify for a missing Examples section when the same audit rates genuinely broken behavior Medium; align with ux-primary-commands-lack-examples-in-help.md and ux-spawn-help-still-no-examples.md as one piece of work. Its strongest configure-specific argument doubles as a blocker: the examples users most need are the flags that are currently mis-documented (--skip-if-configured), so fix that help lie first or the examples will encode it."
---

# UX: configure --help has no Examples section

## Summary

configure --help lists options including skip-if-configured but no Examples (contrast models).

## Evidence

configure help: Options only; no Examples.

## Why it matters

Primary onboarding command lacks copy-paste recipes.

## Suggested direction

Add Examples: configure claude --model … --yes; --skip-if-configured; --dry-run.

## Severity

**High**

## Area

Help / configure
