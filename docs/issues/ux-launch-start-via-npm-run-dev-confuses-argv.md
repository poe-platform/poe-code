---
severity: medium
impact: usability
comment: "The most honest file in the launch set: it identifies that the harness is contaminating the results - garbage process ids like 'slee:' plus a newline came from multi-line shell invocation through the npm run dev wrapper, not from launch itself. That explains the blank-ID and unremovable-row filings and means those must be re-verified against the installed binary before anyone builds GC for them. Its durable ask survives regardless: validate process ids strictly and refuse control characters. Read this before scheduling any other launch issue."
---

# UX: launch start argv is fragile under npm run dev / turbo predev

## Summary

launch start can mis-parse process ids and commands when invoked through npm run dev (turbo predev noise, shell line breaks), creating garbage process ids like slee:\n# and opaque timeouts.

## Evidence

Broken id observed in launch status table: slee: then newline then #.
Caused by multi-line shell invocation interacting with npm run dev wrapper.

## Why it matters

Launch is already advanced; fragile argv makes it unusable for scripted local use via recommended dev entry.

## Suggested direction

Document that launch should be invoked via installed binary; harden id validation; improve start failure to show received argv.

## Severity

Medium

## Area

Launch
