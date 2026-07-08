# UX: Dev-mode usage intentionally emits npm run dev

## Summary

execution-context maps development to npm run dev -- leaking into all help/errors.

## Evidence

formatCliUsageCommand development case.

## Why it matters

Root cause of identity cluster.

## Suggested direction

Split displayBinaryName vs debugInvocation.

## Severity

**High**

## Area

Help / identity
