---
severity: medium
impact: usability
comment: "One of three near-identical filings of 'No runtime job found' plus See logs across stop/logs/attach; consolidate into one. All are instances of ux-user-errors-look-like-system-failures.md where the message is already right. Their shared residue - suggest runtime jobs ls - is undermined by the ls problems (ux-runtime-jobs-ls-unbounded-may-era-reconfirmed.md), so fix the list before recommending it."
---

# UX: runtime jobs stop/logs missing id has See logs

## Summary

runtime jobs stop/logs missing-id: No runtime job found + See logs — clear message, system chrome.

## Evidence

No runtime job found for "missing-id" + See logs.

## Why it matters

UserError without logs.

## Suggested direction

UserError; suggest runtime jobs ls.

## Severity

Medium

## Area

Runtime jobs
