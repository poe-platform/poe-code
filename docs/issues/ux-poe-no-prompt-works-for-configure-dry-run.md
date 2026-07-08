# UX: POE_NO_PROMPT=1 accepts configure defaults (positive/obscure)

## Summary

POE_NO_PROMPT=1 configure claude --model haiku --dry-run proceeds without TTY — works but remains obscure vs --yes (which also works).

## Evidence

POE_NO_PROMPT=1 configure … --dry-run proceeds.

## Why it matters

Positive that env works; prefer --yes in user-facing copy.

## Suggested direction

Prefer --yes in errors; keep env as escape hatch.

## Severity

Low

## Area

Configure / positive pattern
