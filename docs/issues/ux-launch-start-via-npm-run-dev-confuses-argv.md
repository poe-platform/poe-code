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
