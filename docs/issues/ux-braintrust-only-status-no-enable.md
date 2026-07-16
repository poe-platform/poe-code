---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/braintrust.ts:11-22 registers only 'status' under the braintrust group; no enable/disable subcommand exists, and src/cli/commands/configure.ts has no braintrust path. Enabling requires hand-editing integrations.braintrust.enabled (packages/poe-code-config/src/types.ts:79-87), with the API key supplied via config interpolation only (packages/braintrust/README.md:46)."
comment: "The strongest of the four Braintrust filings and the only one naming a real capability gap rather than copy: status reports a state the CLI gives users no way to change. Keep as canonical; the three 'disabled is opaque' files are symptoms of this. Decide first whether Braintrust is env-configured by design - if so, this collapses to a documentation fix and status should simply name the env var."
---

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
