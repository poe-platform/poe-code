# UX: invalid --resume-thread-id surfaces raw agent --resume usage text

## Summary

Invalid resume id fails with Claude Code spawn failed … Error: --resume requires a valid session ID… Usage: claude -p --resume … — agent-native error (reaffirm resume-thread-errors-are-agent-raw).

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --model haiku --resume-thread-id not-a-real-id
■  Error: Claude Code spawn failed with exit code 1: Error: --resume requires a valid session ID…
```

## Why it matters

Should be ValidationError before spawn; suggest traces for session ids.

## Suggested direction

Validate UUID/format; map agent resume errors to UserError.

## Severity

**High**

## Area

Spawn / resume
