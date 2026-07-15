---
severity: medium
impact: usability
comment: "Real but scoped to the dev workflow rather than the shipped product: this is what npm run dev does by design (predev runs turbo build), so an installed user never sees it. Its value is as further evidence for ux-development-mode-usage-intentional-but-leaks.md - the audit was conducted through npm run dev, which is precisely why the identity cluster exists. Keep as a dev-UX note; do not schedule as a product defect."
---

# UX: launch commands trigger full turbo monorepo rebuild via npm run dev

## Summary

Invoking launch through npm run dev / predev runs turbo build across 68 packages before the command, adding multi-second latency and noisy logs to every launch start/status.

## Evidence

npm run dev predev turbo output appears before launch results every time.

## Why it matters

Ops commands feel broken/slow; obscures actual command output.

## Suggested direction

Document using installed binary; avoid predev for pure CLI ops when possible; quieter predev.

## Severity

Medium

## Area

Launch / dev UX
