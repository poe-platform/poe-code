---
severity: medium
impact: capability-gap
comment: "Keep as the canonical doctor issue rather than the four 'doctor still missing' reconfirms: the only one that specifies what doctor should do (auth, agents, stale models, provider logins, runtime in one screen with next actions) and why it matters. The audit itself is the best argument for it - the sonnet-5, effort and settings-corruption clusters were all found by hand-checking exactly these things. Consolidate the reconfirms into it."
---

# UX: No doctor/health overview command for setup diagnostics

## Summary

There is no poe-code doctor (or similar) that summarizes auth status, configured agents, stale models, provider logins, and runtime availability in one screen. Users must run many commands and interpret failures piecemeal.

## Evidence

doctor → command not found
Users currently stitch: auth status, provider list, configure --skip-if-configured, models, test, runtime.

## Why it matters

Setup diagnosis is a top support cost; fragmented surfaces hide stale model and auth issues.

## Suggested direction

Add doctor/status overview with green/yellow/red checks and next actions.

## Severity

Medium

## Area

First-run / diagnostics
