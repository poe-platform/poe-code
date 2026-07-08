# UX: plan archive --help omits --yes / selection behavior

## Summary

plan archive help shows optional path and --kind/--output but does not document non-TTY selection requiring path or --yes, nor that --yes without path archives an arbitrary plan.

## Evidence

plan archive --help — path optional; no --yes mentioned (global --yes may apply).

## Why it matters

Destructive command help must document non-interactive contract and footguns.

## Suggested direction

Document required path for non-TTY; forbid --yes without path; list --yes if supported.

## Severity

**High**

## Area

Plan / destructive
