# UX: braintrust only has status; enable is not a command

## Summary

braintrust --help only status; braintrust enable falls back to same help — no enable/disable surface despite status disabled message elsewhere.

## Evidence

braintrust commands: status only. enable not registered.

## Why it matters

Users cannot turn Braintrust on from CLI if only status exists.

## Suggested direction

Add enable/disable or document env-only config in status next steps.

## Severity

Medium

## Area

Braintrust
