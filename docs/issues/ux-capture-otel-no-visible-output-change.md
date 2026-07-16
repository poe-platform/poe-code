---
severity: low-medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "No OTel path/confirmation is printed anywhere: endpoint built at packages/agent-spawn/src/native-otel.ts:42 is only passed via env; records go to ctx.metadata (packages/agent-spawn/src/acp/spawn.ts:495-501); rg 'nativeOtel' over src/ (non-test) returns nothing; the extra idea 'warn when unsupported for agent' already exists at native-otel.ts:25"
comment: "Duplicate of ux-capture-otel-alone-silent-success.md; retire into it, carrying over its one extra idea - warn when the flag is unsupported for the selected agent - which is the more useful half of the fix. Rated Low-Medium against the twin's Medium for identical behavior; normalise."
---

# UX: --capture-otel succeeds with no visible confirmation of capture

## Summary

spawn … --capture-otel succeeds like normal spawn without saying where OTEL was written or if capture was active.

## Evidence

spawn with --capture-otel → normal ✓ agent output; no OTEL path.

## Why it matters

Flag may silently no-op; users cannot verify capture.

## Suggested direction

Print OTEL output path or warn if unsupported for agent.

## Severity

Low–Medium

## Area

Spawn / telemetry
