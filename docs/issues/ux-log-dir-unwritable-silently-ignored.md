---
severity: high
impact: correctness
comment: "The real defect in the logging set and correctly High: --log-dir pointing at an uncreatable path succeeds silently and no logs are written, so users believe they have a record of a run and do not. Worse than the missing-path-echo issue because the failure is invisible rather than merely unhelpful - and it is discovered only when the logs are actually needed. Fail or warn when the directory cannot be created; combined with printing the path (ux-log-file-name-no-path-feedback.md) the whole class disappears."
reproduced: y
recommendation: fix
evidence: "packages/agent-spawn/src/acp/middlewares/spawn-log.ts:150-160 ensureOpen() wraps mkdir/open in try/catch and only sets isDisabled=true with no warning or error; spawn-log.ts:224 still sets ctx.logFile to the never-written path, and no warn call exists in src/cli/commands/spawn.ts"
---

# UX: --log-dir unwritable may be silently ignored

## Summary

spawn with --log-dir /no/perm/dir still succeeds without warning that logs were not written.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --model haiku --log-dir /no/perm/dir
✓ agent: … (success)
$ ls /no/perm/dir → No such file or directory
```

## Why it matters

Users believe logs were captured when they were not.

## Suggested direction

Fail or warn if log-dir cannot be created/written.

## Severity

**High**

## Area

Spawn / logging
