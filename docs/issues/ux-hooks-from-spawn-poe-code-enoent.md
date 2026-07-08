# UX: --hooks-from can fail with spawn poe-code ENOENT

## Summary

test/spawn with --hooks-from may exec poe-code not on PATH (tsx entry), opaque ENOENT.

## Evidence

test codex --hooks-from claude-code → spawn poe-code ENOENT.

## Why it matters

Looks like missing binary not miswired hooks.

## Suggested direction

Resolve host binary from argv; clear error.

## Severity

**High**

## Area

Hooks / spawn
