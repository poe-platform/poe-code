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
