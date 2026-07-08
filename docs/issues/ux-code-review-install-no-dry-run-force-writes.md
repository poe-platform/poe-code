# UX: code-review install --force writes with no dry-run and wraps paths poorly

## Summary

code-review install --force creates profiles/prompts under .poe-code/code-review with word-wrapped path lists and no --dry-run option; help uses npm run dev.

## Evidence

code-review install --force → Created …paths word-wrapped mid-path…

## Why it matters

Unexpected writes; hard to read paths.

## Suggested direction

Add --dry-run; design-system path list; displayBinaryName.

## Severity

Medium

## Area

Code-review
