# Wrap signal-terminated isolated agent exits successfully

## Summary

The `poe-code wrap` isolated-agent execution path converts a wrapped binary that was killed by a signal into a successful wrapper exit. `isolatedEnvRunner()` calls `process.exit(code ?? 0)` on child close, so Node's `code === null` signal-termination status becomes exit code zero.

## Reproduction

1. From the repository root, create this disposable unit probe:

   ```sh
   cat > src/cli/__probe__.test.ts <<'EOF'
   import { EventEmitter } from "node:events";
   import { describe, expect, it, vi } from "vitest";

   const spawnMock = vi.hoisted(() => vi.fn());
   vi.mock("node:child_process", () => ({ spawn: spawnMock }));

   import { createCliEnvironment } from "./environment.js";
   import { isolatedEnvRunner } from "./isolated-env-runner.js";

   describe("isolated wrapper killed child", () => {
     it("exits the wrapper with code zero after child signal termination", async () => {
       const child = new EventEmitter();
       spawnMock.mockReturnValue(child);
       const exitMock = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
       void isolatedEnvRunner({
         env: createCliEnvironment({ cwd: "/repo", homeDir: "/home/test" }),
         providerName: "codex",
         isolated: { agentBinary: "codex", requiresConfig: false, env: {} },
         argv: ["node", "poe-code", "--version"]
       });
       await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));

       child.emit("close", null, "SIGTERM");

       expect(exitMock).toHaveBeenCalledWith(0);
     });
   });
   EOF
   ```

2. Run the probe and remove it afterward:

   ```sh
   npm exec -- vitest run src/cli/__probe__.test.ts --reporter verbose
   rm -f src/cli/__probe__.test.ts
   ```

3. The disposable probe passes:

   ```text
   ✓ src/cli/__probe__.test.ts > isolated wrapper killed child > exits the wrapper with code zero after child signal termination

   Test Files  1 passed (1)
        Tests  1 passed (1)
   ```

## Observed Behavior

After the wrapped isolated agent child emits `close` with `(null, "SIGTERM")`, `isolatedEnvRunner()` invokes `process.exit(0)`. The implementation spawns the agent at `src/cli/isolated-env-runner.ts:42` through `src/cli/isolated-env-runner.ts:48`, then handles close at `src/cli/isolated-env-runner.ts:54` through `src/cli/isolated-env-runner.ts:56` by converting any null status to zero.

## Expected Behavior

If the wrapped agent process is terminated by a signal, `poe-code wrap` should terminate with a failure status or propagate an equivalent signal outcome. It should not report a successful wrapper exit for an agent process that did not complete successfully.

## Impact

Automation that launches isolated provider binaries through `poe-code wrap` can misclassify interrupted or externally killed agent runs as successful. Shell scripts, CI jobs, and higher-level callers may proceed after incomplete work because the wrapper publishes an exit code of zero.
