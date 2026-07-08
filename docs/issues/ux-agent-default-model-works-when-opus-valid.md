# UX: agent default model (opus-4.7) works (positive contrast to sonnet-5)

## Summary

agent "say only: ok" without --model succeeds using default anthropic/claude-opus-4.7 — positive that DEFAULT_FRONTIER_MODEL works while CLAUDE_CODE default sonnet-5 fails.

## Evidence

```bash
$ poe-code agent "say only: ok"
✓ agent: ok
◆  Agent response received.
```
constants: DEFAULT_FRONTIER_MODEL = opus-4.7; DEFAULT_CLAUDE_CODE_MODEL = sonnet-5.

## Why it matters

Shows split brain: agent path OK, claude configure path poisoned.

## Suggested direction

Align claude default to live catalog like agent default.

## Severity

Low

## Area

Agent / positive pattern
