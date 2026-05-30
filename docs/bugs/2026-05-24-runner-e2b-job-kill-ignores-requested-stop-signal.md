---
name: "E2B detached job kill ignores the requested stop signal"
---

# E2B detached job kill ignores the requested stop signal

## Summary

The shared detached-job API accepts an optional POSIX signal so runtime stop logic can request `SIGTERM` first and escalate to `SIGKILL` after a grace period. The E2B job-handle implementation ignores that signal parameter entirely and issues the same SDK `commands.kill(pid)` call for both requests, so the documented graceful-stop/escalation behavior cannot be honored by the E2B backend.

## Reproduction

1. From the repository root, run this disposable probe. It records the mocked E2B SDK calls made for two distinct requested signals:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-signal-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { createE2bJobHandle } from "${workspace}/packages/runner-e2b/src/job-handle.ts";
   const calls: unknown[] = [];
   const sandbox = {
     commands: { list: async () => [], kill: async (...args: unknown[]) => { calls.push(args); return true; } },
     files: { read: async () => "0" },
     setTimeout: async () => {}
   } as any;
   const handle = createE2bJobHandle({
     sandbox, envId: "sb", jobId: "job", tool: "node", argv: ["node"], pid: 42, preserveAfterExitHours: 24
   });
   await handle.kill("SIGTERM");
   await handle.kill("SIGKILL");
   console.log(JSON.stringify(calls));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

Both different requested signals are reduced to identical SDK calls containing only the PID:

```text
[[42],[42]]
```

The shared job contract exposes `kill(signal?: NodeJS.Signals)` in `packages/agent-harness-tools/src/execution-env.ts:79` through `packages/agent-harness-tools/src/execution-env.ts:88`, and graceful stop explicitly requests `SIGTERM` before escalating to `SIGKILL` in `src/cli/commands/runtime/jobs/shared.ts:157` through `src/cli/commands/runtime/jobs/shared.ts:167`. The E2B implementation declares `async kill()` without accepting or translating the requested signal in `packages/runner-e2b/src/job-handle.ts:48` through `packages/runner-e2b/src/job-handle.ts:56`.

## Expected Behavior

The E2B backend should implement the shared requested-signal semantics, or the command layer should explicitly model that E2B supports only immediate termination instead of presenting an ineffective graceful-stop/escalation sequence.

## Impact

E2B jobs may be terminated abruptly when users expect cleanup time after a normal stop request, and the subsequent `SIGKILL` escalation path provides no stronger action than the initial request while still presenting itself as graceful-stop behavior.
