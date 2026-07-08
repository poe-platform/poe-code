# UX: hooks-strategy transform to claude-code not supported yet

## Summary

spawn --hooks-from claude-code --hooks-strategy transform: Transforming hooks to claude-code is not supported yet; only codex-hook targets can be written + See logs.

## Evidence

Transforming hooks to "claude-code" is not supported yet; only codex-hook targets can be written

## Why it matters

Reconfirm hooks capability matrix; late failure after flag accepted.

## Suggested direction

Reject unsupported pairs at parse; list supported source→target matrix.

## Severity

**High**

## Area

Hooks / spawn
