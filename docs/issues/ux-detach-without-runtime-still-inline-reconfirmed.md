---
severity: high
impact: correctness
comment: "Companion to ux-detach-runtime-host-still-inline.md rather than a strict duplicate - that covers --detach with --runtime host, this without any runtime. Merge into one issue, because the useful conclusion only emerges from the pair: detach never produces a job id under any runtime tested, so the flag looks entirely unwired. Fix as one decision about detach semantics."
reproduced: y
recommendation: no-fix
evidence: "packages/agent-harness-tools/src/poe-command-execution.ts:58 detach = factory.supportsDetach === true && config.runner.detach; default runtime type is host (packages/poe-code-config/src/runtime.ts:67) and packages/process-runner/src/host/host-execution-env.ts:6 sets supportsDetach: false, so --detach is silently dropped and the run stays inline with no job id; duplicate of ux-spawn-detach-silently-ignored-without-runtime.md which is the designated surviving issue"
---

# UX: --detach without --runtime still runs inline (reconfirmed)

## Summary

spawn … --detach without --runtime host/docker/e2b still runs inline with ✓ agent and Resume — no job id (related detach+host still-inline).

## Evidence

spawn … --detach → inline success, no job id.

## Why it matters

Reconfirm detach requires runtime context.

## Suggested direction

Error: --detach requires --runtime docker|e2b; or return job id for host.

## Severity

**High**

## Area

Spawn / runtime
