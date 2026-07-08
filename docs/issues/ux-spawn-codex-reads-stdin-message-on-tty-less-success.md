# UX: successful codex spawn prints "Reading additional input from stdin..."

## Summary

Even when prompt is provided as an argument, successful codex spawn emits Reading additional input from stdin... which confuses non-interactive runs and looks like the process is still waiting.

## Evidence

```bash
$ poe-code spawn codex "say only: ok" --mode read --model openai/gpt-5.3-codex
✓ agent: ok
●  Reading additional input from stdin...
●  Resume: codex resume …
```

## Why it matters

False waiting signal on success path; CI logs look hung.

## Suggested direction

Suppress stdin wait message when prompt already provided; only show when actually reading stdin.

## Severity

Medium

## Area

Spawn / codex
