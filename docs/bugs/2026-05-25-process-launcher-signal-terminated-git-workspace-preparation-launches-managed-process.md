# Process launcher signal-terminated Git workspace preparation launches managed process

## Summary

`@poe-code/process-launcher` treats signal-terminated Git commands used to prepare `github://` managed-process workspaces as successful. Its synchronous workspace command adapter maps `spawnSync()` results with `status === null` to `exitCode: 0`, allowing a launch to proceed even when `git clone` or `git worktree add` was killed before completion.

## Reproduction

1. From the repository root, create this disposable probe, replacing its temporary directory literal as shown by the shell heredoc:

   ```sh
   probe_root=$(mktemp -d /tmp/process-launcher-signal-probe.XXXXXX)
   cat > packages/process-launcher/src/supervisor/__probe__.test.ts <<EOF
   import { mkdirSync } from "node:fs";
   import path from "node:path";
   import { describe, expect, it, vi } from "vitest";
   import { createMockRunner } from "@poe-code/process-runner/testing";

   const spawnSyncMock = vi.hoisted(() => vi.fn());
   vi.mock("node:child_process", () => ({ spawnSync: spawnSyncMock }));

   import { createSupervisor } from "./supervisor.js";

   describe("Git workspace command signal termination", () => {
     it("starts the daemon after all Git preparation commands are terminated", async () => {
       const homeDir = "$probe_root/home";
       const stateDir = path.join(homeDir, ".poe-code", "launch");
       const cacheDir = path.join(homeDir, ".poe-code", "workspaces", "github", "owner-repo");
       spawnSyncMock.mockImplementation((_command: string, args: string[]) => {
         if (args[0] === "clone") mkdirSync(cacheDir, { recursive: true });
         return { status: null, signal: "SIGTERM", stdout: "", stderr: "" };
       });
       const exec = vi.fn(createMockRunner([{ pid: 7, exitCode: 0, exitAfterMs: 60_000 }]).exec);
       const supervisor = createSupervisor({
         stateDir,
         runner: { name: "mock", exec },
         spec: { id: "job", command: "npm", args: ["run", "dev"], cwd: "github://owner/repo", restart: "never" }
       });

       await supervisor.start();

       expect(spawnSyncMock).toHaveBeenCalledTimes(2);
       expect(exec).toHaveBeenCalledTimes(1);
       expect(supervisor.getState().status).toBe("running");
     });
   });
   EOF
   ```

2. Run the probe and clean up the disposable files:

   ```sh
   npm exec -- vitest run packages/process-launcher/src/supervisor/__probe__.test.ts --reporter verbose
   rm -f packages/process-launcher/src/supervisor/__probe__.test.ts
   rm -rf "$probe_root"
   ```

3. The disposable probe passes:

   ```text
   ✓ packages/process-launcher/src/supervisor/__probe__.test.ts > Git workspace command signal termination > starts the daemon after all Git preparation commands are terminated

   Test Files  1 passed (1)
        Tests  1 passed (1)
   ```

## Observed Behavior

The supervisor starts its configured managed command after both mocked Git preparation invocations return `{ status: null, signal: "SIGTERM" }`. Git workspaces are resolved through the adapter passed at `packages/process-launcher/src/supervisor/supervisor.ts:465` through `packages/process-launcher/src/supervisor/supervisor.ts:469`; its `spawnSync()` result is converted at `packages/process-launcher/src/supervisor/supervisor.ts:498` through `packages/process-launcher/src/supervisor/supervisor.ts:520`, where `result.status ?? 0` turns signal termination into success.

## Expected Behavior

Workspace preparation should fail when any Git command is terminated by a signal. A supervisor configured to launch in a `github://` workspace should not execute its managed process unless the clone and writable checkout commands completed successfully.

## Impact

Managed processes can be launched inside missing, partial, or stale Git workspaces after external termination of workspace setup commands. The service is reported as running even though its requested source checkout was not successfully prepared, leading to execution of unintended files or misleading deployment status.
