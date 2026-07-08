# UX: runtime templates ls is unbounded with May-era e2b entries

## Summary

runtime templates ls shows many e2b template cache rows from 2026-05-04 with no --limit — same unbounded history class as runtime jobs ls.

## Evidence

templates ls → many e2b rows dated May 2026.

## Why it matters

Unusable cache inventory; no prune UX until clear.

## Suggested direction

Default recent N; --all; age column; prune command.

## Severity

**High**

## Area

Runtime
