# Agent child process signaled exit loses termination signal

## Summary

`@poe-code/agent-child-process` discards the operating-system signal that terminated a spawned child. A process killed with `SIGTERM` resolves to the same public result shape as an ordinary command that exited with status `1`, so callers cannot distinguish cancellation or forced shutdown from application failure.

## Reproduction

Create the disposable probe `packages/agent-child-process/src/__probe__.test.ts`:

```ts
import { spawn as nodeSpawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { spawn } from "./index.js";

describe("signaled child reporting", () => {
  it("reports a SIGTERM-terminated process as ordinary exit code 1", async () => {
    const handle = spawn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 10000)"],
      { spawnProcess: nodeSpawn }
    );

    expect(handle.kill("SIGTERM")).toBe(true);
    const result = await handle.result;
    console.log(JSON.stringify(result));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-child-process/src/__probe__.test.ts --reporter verbose
```

Result:

```text
{"kind":"spawn","command":"/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node","args":["-e","setTimeout(() => {}, 10000)"],"exitCode":1,"stdout":"","stderr":"","attempts":[{"kind":"spawn","command":"/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node","args":["-e","setTimeout(() => {}, 10000)"],"exitCode":1,"stdout":"","stderr":""}]}
✓ packages/agent-child-process/src/__probe__.test.ts > signaled child reporting > reports a SIGTERM-terminated process as ordinary exit code 1
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

Node's child-process `close` event provides both an exit `code` and a termination `signal`. `collectResult()` in `packages/agent-child-process/src/index.ts:222` listens with `child.once("close", (code) => finish(code ?? 1));`, ignoring the signal argument and converting a signal-only close event with `code === null` into `exitCode: 1`. After `handle.kill("SIGTERM")`, the returned result contains only `exitCode: 1` and empty output; it exposes no indication that the child was terminated by `SIGTERM`.

## Expected Behavior

Results for a child terminated by a signal should preserve its termination reason, such as a `signal: "SIGTERM"` field or another documented cancellation representation. A caller should be able to tell forced termination from a command that voluntarily exited with status `1`.

## Impact

Callers cannot reliably classify cancelled, timed-out, or externally killed agent executions. This can mislabel user-initiated termination as an application error, obscure why work stopped, and make timeout or retry handling act on incomplete process diagnostics.
