---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "packages/agent-spawn/src/configs/claude-code.ts:32-33 resume.args maps threadId straight to '--resume' with no format check; packages/agent-spawn/src/spawn.ts:185-198 getResumeArgs forwards resumeThreadId unvalidated; src/cli/commands/spawn.ts:428 rethrows raw agent stderr as 'spawn failed with exit code'. Behaviour real but duplicate of ux-resume-thread-invalid-agent-raw-error.md, which carries the fix."
comment: "Third filing of the raw agent resume error; retire into ux-resume-thread-invalid-agent-raw-error.md. Its distinct suggestion is the most useful in the trio and worth carrying: point users at traces to find valid session ids, which turns the error from a rejection into a recovery. Rated High against its Medium twins for identical behavior; normalise."
---

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
