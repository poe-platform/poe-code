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
