# UX: Hook bridge “Refuse to replace user-authored hook file” is opaque

## Summary

spawn with --hooks-from/--hooks-scope can fail with Refuse to replace user-authored hook file at …/settings.json without explaining how to proceed (different scope, strategy, or backup).

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --hooks-from claude-code --hooks-scope project
■  Error: Refuse to replace user-authored hook file at …/.claude/settings.json
●  See logs …
```

## Why it matters

Power feature dead-ends without recovery; safety refusal needs next steps.

## Suggested direction

Explain why refused; suggest --hooks-strategy, scope change, or manual merge docs; ValidationError without errors.log.

## Severity

Medium

## Area

Hooks / spawn
