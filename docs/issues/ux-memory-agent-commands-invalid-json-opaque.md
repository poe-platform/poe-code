# UX: memory explain/query fail with opaque "invalid JSON output"

## Summary

memory explain and memory query fail with Memory agent returned invalid JSON output + See logs — no agent stderr, model used, or recovery (configure model / retry). Likely stale default model in agent path.

## Evidence

```bash
$ poe-code memory explain pages/note.md
■  Error: Memory agent returned invalid JSON output.
●  See logs …
$ poe-code memory query "what is note"
■  Error: Memory agent returned invalid JSON output.
```

## Why it matters

Users cannot debug agent-backed memory features.

## Suggested direction

Surface agent error/model; validate model; UserError with configure hint.

## Severity

**High**

## Area

Memory
