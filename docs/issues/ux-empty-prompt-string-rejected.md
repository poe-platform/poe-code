# UX: empty prompt string rejected (positive for spawn/agent)

## Summary

spawn claude "" and agent "" both reject empty prompts — good. spawn: No prompt provided; agent: Prompt must not be empty (slight wording inconsistency).

## Evidence

```bash
$ poe-code spawn claude "" --mode read --model haiku
■  Error: No prompt provided via argument or stdin
$ poe-code agent "" --model haiku
■  Error: Prompt must not be empty.
```

## Why it matters

Positive empty-prompt rejection; unify wording.

## Suggested direction

Unify message; drop See logs.

## Severity

Low

## Area

Spawn / positive pattern
