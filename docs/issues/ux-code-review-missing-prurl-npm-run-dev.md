# UX: code-review run/commit missing prUrl uses npm run dev recovery

## Summary

code-review run without prUrl: missing required argument prUrl; Run npm run dev -- code-review run --help — raw + wrong binary name.

## Evidence

missing required argument 'prUrl' + npm run dev recovery.

## Why it matters

Reconfirm displayBinaryName on code-review toolcraft commands.

## Suggested direction

displayBinaryName=poe-code; design-system ValidationError.

## Severity

Medium

## Area

Code-review / identity
