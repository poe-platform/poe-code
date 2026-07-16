---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "packages/agent-harness-tools/src/poe-command-execution.ts:58 computes detach = factory.supportsDetach === true && config.runner.detach; default runtime type is host (packages/poe-code-config/src/runtime.ts:67 parseRuntimeType returns 'host') and packages/process-runner/src/host/host-execution-env.ts:6 sets supportsDetach: false, so --detach without --runtime is silently dropped and the run stays inline with no job id and no warning"
comment: "Duplicate of ux-detach-without-runtime-still-inline-reconfirmed.md; consolidate into the single detach-semantics issue. Its framing is the best of the four and should survive: users believe work is backgrounded when it is not, which for CI means a script that waits or exits on the wrong assumption. Same flag-dependency family as --runner-sync and --capture-otel-content."
---

# UX: spawn --detach appears silently ignored without --runtime

## Summary

spawn … --detach without --runtime still runs the agent inline and succeeds; no warning that detach requires a runtime backend. Users may think the job was detached.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --model haiku --detach
# runs inline, prints ✓ agent: … Resume: …
# no job id, no detach confirmation
```

## Why it matters

False belief that work is backgrounded; CI/scripts may hang.

## Suggested direction

Error if --detach without --runtime; or default runtime host detach with job id.

## Severity

**High**

## Area

Spawn / runtime
