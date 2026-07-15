---
severity: medium
impact: discoverability
comment: "One of three near-identical filings that 'braintrust status: disabled' offers no recovery path. Consolidate with ux-braintrust-status-minimal-disabled.md and ux-braintrust-status-opaque.md, and treat the result as dependent on ux-braintrust-only-status-no-enable.md: the next step cannot be written until it is decided whether enabling is a CLI command or env-only."
---

# UX: braintrust status disabled with no enable next step

## Summary

braintrust status: disabled — no how to enable, no env vars, no link to docs.

## Evidence

●  disabled

## Why it matters

Status without recovery is incomplete.

## Suggested direction

Next: set BRAINTRUST_API_KEY / poe-code braintrust enable if added.

## Severity

Medium

## Area

Braintrust
