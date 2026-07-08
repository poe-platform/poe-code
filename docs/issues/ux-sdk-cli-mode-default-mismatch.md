# UX: SDK and CLI disagree on default permission mode

## Summary

SDK defaults mode to yolo; CLI spawn prompts/--yes yolo; gaslight defaults auto.

## Evidence

SDK JSDoc default yolo; spawn help --yes uses yolo; gaslight default auto.

## Why it matters

Safety default product decision; three answers.

## Suggested direction

One policy matrix; prefer safe library default.

## Severity

**High**

## Area

SDK / safety
