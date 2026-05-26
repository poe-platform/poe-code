# Agent child process follow-up rejection discards original command result

## Summary

`@poe-code/agent-child-process` can run an optional agent follow-up after a child command completes. If that follow-up runner rejects, the exported operation rejects with the raw follow-up error and drops the completed child-process result, including its original exit code, `stdout`, and `stderr`, even though policy-evaluation failures are wrapped with those diagnostics intact.

## Reproduction

Add the following temporary probe as `packages/agent-child-process/src/__probe__.test.ts`:

```ts
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { execFile } from "./index.js";

describe("rejected follow-up agent", () => {
  it("rejects without preserving the completed child-process attempt", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), stdin: null, pid: 10,
      kill: vi.fn(() => true)
    }) as unknown as ChildProcess;
    const result = execFile("npm", ["test"], {
      spawnProcess: vi.fn(() => child),
      runAgent: vi.fn(async () => { throw new Error("agent unavailable"); }),
      onExit: { agent: "codex", prompt: "Diagnose" }
    });

    child.stderr?.emit("data", Buffer.from("original failure"));
    child.emit("close", 1);

    await expect(result).rejects.toThrow("agent unavailable");
    await result.catch((error) => console.log(JSON.stringify({ name: error.name, message: error.message, hasResult: "result" in error })));
  });
});
```

Run:

```sh
npm exec vitest run -- packages/agent-child-process/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"name":"Error","message":"agent unavailable","hasResult":false}
✓ packages/agent-child-process/src/__probe__.test.ts > rejected follow-up agent > rejects without preserving the completed child-process attempt
```

Remove the temporary probe after confirming the reproduction.

## Observed Behavior

The child attempt completes with exit code `1` and recorded `stderr`, but the returned promise rejects only with the raw `Error("agent unavailable")`, which has no `result` field. In `packages/agent-child-process/src/index.ts`, `maybeRunAgent()` wraps failures from `policy.when()` in `AgentChildProcessError` yet directly awaits `runAgent()` without an equivalent catch-and-wrap boundary, so a follow-up failure eclipses the completed command diagnostics.

## Expected Behavior

If an optional follow-up agent fails after the original child attempt is already complete, callers should receive an `AgentChildProcessError` or equivalent structured failure that preserves the original command result and identifies the follow-up failure as its cause. The diagnostic evidence from the command being analyzed must remain accessible.

## Impact

A transient agent outage, authentication error, cancellation, or follow-up crash can hide the command output that triggered the follow-up in the first place. Callers cannot inspect the original test/build failure from the rejection object, making automated diagnosis and recovery substantially harder precisely on failure paths.
