# UX: Successful spawn still uses ✓ for agent narrative text

## Summary

Even successful spawn pi output prefixes agent thinking/answer lines with ✓, same glyph as success status — consistent with ACP stream glyph issue.

## Evidence

```text
  ✓ The user wants me to say only "ok".
✓ agent: ok
✓ tokens: …
```

## Why it matters

Status language remains muddled even when the run succeeds.

## Suggested direction

Neutral bullets for content; ✓ only for completed success steps.

## Severity

Medium

## Area

Visual language
