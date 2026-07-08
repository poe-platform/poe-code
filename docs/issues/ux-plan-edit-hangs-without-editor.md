# UX: plan edit may hang instead of failing when $EDITOR unset

## Summary

plan edit without EDITOR/VISUAL can hang or fail to return a clear ValidationError within a short time (observed timeout in non-interactive probe), unlike utils config edit which fails fast with Set $EDITOR.

## Evidence

env -u EDITOR plan edit … — probe timed out / unclear failure vs utils config edit fast Error: Set $EDITOR.

## Why it matters

Inconsistent missing-editor handling; hang is worse than error.

## Suggested direction

Fail fast ValidationError like other edit commands; never hang without TTY editor.

## Severity

**High**

## Area

Plan / editor
