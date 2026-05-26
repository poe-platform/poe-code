# Agent-script signal dump failed write corrupts prior checkpoint

## Summary

The agent-script SIGUSR1 dump handler writes each newly generated snapshot directly to the configured `dumpPath`. If writing a later signal dump partially modifies an existing recoverable checkpoint before rejecting, the handler logs a write failure while leaving the earlier valid checkpoint replaced by corrupt partial output.

## Reproduction

From the repository root, add a disposable probe at `packages/agent-script/src/runner/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { attachSignalDumpHandler } from "./signal-dump.js";

describe("signal dump interrupted replacement repro", () => {
  it("reports failure after corrupting a prior saved dump", async () => {
    let handler: (() => void) | undefined;
    let savedDump = '{"previous":"recoverable"}\n';
    const signalProcess = {
      on: vi.fn((_signal: "SIGUSR1", listener: () => void) => {
        handler = listener;
        return signalProcess;
      }),
      off: vi.fn(() => signalProcess)
    };
    const stderr = { write: vi.fn() };

    attachSignalDumpHandler(new Promise(() => undefined), {
      dumpPath: "/tmp/run.json",
      dumpResult: async () => '{"new":"snapshot"}\n',
      process: signalProcess,
      stderr,
      writeFile: async () => {
        savedDump = '{"new":';
        throw new Error("dump write interrupted");
      }
    });

    handler?.();
    await vi.waitFor(() => {
      expect(stderr.write).toHaveBeenCalled();
    });

    expect(savedDump).toBe('{"new":');
    expect(stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("Failed to write SIGUSR1 dump to /tmp/run.json: dump write interrupted")
    );
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/agent-script/src/runner/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-script/src/runner/__probe__.test.ts > signal dump interrupted replacement repro > reports failure after corrupting a prior saved dump
```

Remove the disposable probe after validation.

## Observed Behavior

The probe begins with a prior recoverable dump, invokes the installed SIGUSR1 handler, and injects an interrupted replacement that stores only the malformed fragment `{"new":` before throwing. The handler writes an error message to stderr, but the saved checkpoint remains corrupted rather than preserving the prior valid dump.

## Expected Behavior

Failed signal-dump publication should preserve the last valid checkpoint, committing the new dump atomically only after all snapshot bytes have been persisted successfully.

## Impact

SIGUSR1 dumps are intended to preserve recoverable in-flight state during long-running executions. A storage interruption during a subsequent dump can erase the only usable earlier checkpoint while merely logging an error, leaving operators unable to resume or inspect the prior paused state after the failure that prompted diagnostic capture.
