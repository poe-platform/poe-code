# UX: spawn --hooks-from with auto demands --yes with not configured via poe message

## Summary

spawn claude with model + --hooks-from claude-code --hooks-strategy auto non-TTY: Claude Code is not configured via poe. Pass --yes to proceed without prompting — even with explicit model; confuses hooks path with configure status.

## Evidence

```bash
$ poe-code spawn claude "say only: ok" --mode read --model anthropic/claude-haiku-4.5 --hooks-from claude-code --hooks-strategy auto
■  Claude Code is not configured via poe. Pass --yes to proceed without prompting.
```

## Why it matters

Hooks/spawn path should not require --yes when model/mode provided; message implies misconfiguration.

## Suggested direction

Honor flags without --yes; or clearer: Hooks bridge requires confirmation. Pass --yes.

## Severity

**High**

## Area

Spawn / hooks
