---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "packages/process-runner/src/host/host-execution-env.ts:6 sets supportsDetach: false; packages/agent-harness-tools/src/poe-command-execution.ts:58 computes detach = factory.supportsDetach === true && config.runner.detach, so --detach --runtime host silently resolves to false and runs inline with no job id or warning"
comment: "Real and well evidenced: --detach --runtime host runs inline and returns no job id, so the flag silently does nothing. Pairs with ux-detach-without-runtime-still-inline-reconfirmed.md - together they show detach is a no-op both with and without a runtime, which suggests the flag is unwired rather than misconfigured. Answer the product question first: is host detach meaningful at all? If not, error; if yes, return a job id. Same silent-no-op family as ux-runner-sync-without-detach-silently-ignored.md."
---

# UX: --detach --runtime host still runs inline without job id

## Summary

spawn … --detach --runtime host still prints ✓ agent and Resume line like normal spawn — no detached job id; detach+host may be no-op or not surface job metadata.

## Evidence

```bash
$ poe-code spawn claude "ok" --mode read --model haiku --detach --runtime host
✓ agent: ok
●  Resume: claude --resume …
# no job id
```

## Why it matters

Users expect background job when both flags set.

## Suggested direction

Return job id; or error detach requires docker/e2b; document host detach semantics.

## Severity

**High**

## Area

Spawn / runtime
