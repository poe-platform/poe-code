# Agent spawn log filename path traversal writes outside the configured log directory

## Summary

The public `spawn()` API documents `logFileName` as an override for the log filename used together with `logDir`, but it joins that string directly onto the configured directory. Supplying `../escaped.jsonl` therefore writes command output outside `logDir` while returning the escaped path as the run's log file.

## Reproduction

1. From the repository root, create this disposable Vitest probe using `memfs` and a mocked child process:

   ```sh
   cat > packages/agent-spawn/src/__probe__.test.ts <<'EOF_TEST'
   import { EventEmitter } from "node:events";
   import { PassThrough } from "node:stream";
   import { describe, expect, it, vi } from "vitest";
   import type { ChildProcessWithoutNullStreams } from "node:child_process";

   const hoisted = vi.hoisted(() => {
     const { Volume, createFsFromVolume } = require("memfs") as typeof import("memfs");
     const volume = new Volume();
     const memFs = createFsFromVolume(volume);
     return { volume, memFs };
   });

   vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
   vi.mock("node:fs", () => hoisted.memFs);

   import { spawn as spawnChildProcess } from "node:child_process";
   import { spawn } from "./spawn.js";

   function createMockChild(): ChildProcessWithoutNullStreams {
     const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
     const stdout = new PassThrough();
     const stderr = new PassThrough();
     (child as unknown as { stdin: PassThrough }).stdin = new PassThrough();
     (child as unknown as { stdout: PassThrough }).stdout = stdout;
     (child as unknown as { stderr: PassThrough }).stderr = stderr;
     (child as unknown as { kill: () => boolean }).kill = () => true;
     setImmediate(() => {
       stdout.end("escaped log\n");
       stderr.end();
       child.emit("close", 0, null);
     });
     return child;
   }

   describe("spawn log filename containment", () => {
     it("writes outside logDir when logFileName contains traversal", async () => {
       vi.mocked(spawnChildProcess).mockReturnValue(createMockChild());

       const result = await spawn("claude-code", {
         prompt: "test",
         logDir: "/tmp/run-logs",
         logFileName: "../escaped.jsonl"
       });

       expect(result.logFile).toBe("/tmp/escaped.jsonl");
       expect(hoisted.memFs.readFileSync("/tmp/escaped.jsonl", "utf8")).toBe("escaped log\n");
     });
   });
   EOF_TEST
   npm exec -- vitest run packages/agent-spawn/src/__probe__.test.ts --reporter verbose
   rm packages/agent-spawn/src/__probe__.test.ts
   ```

2. The probe passes:

   ```text
   ✓ packages/agent-spawn/src/__probe__.test.ts > spawn log filename containment > writes outside logDir when logFileName contains traversal
   ```

## Observed Behavior

Calling `spawn()` with `logDir: "/tmp/run-logs"` and `logFileName: "../escaped.jsonl"` writes captured stdout to `/tmp/escaped.jsonl`, not beneath `/tmp/run-logs`, and returns that escaped path in `result.logFile`.

`packages/agent-spawn/src/types.ts:86` through `packages/agent-spawn/src/types.ts:93` describe `logFileName` as the filename used beneath `logDir`. `packages/agent-spawn/src/spawn.ts:316` through `packages/agent-spawn/src/spawn.ts:329` join the caller value without checking that it is a filename or that the resulting path remains inside `logDir`, then open it for appending.

## Expected Behavior

When `logDir` is supplied, `logFileName` should be constrained to a safe single filename and the resolved log path should remain within the configured directory. Traversal-bearing and absolute filename overrides should be rejected instead of written.

## Impact

SDK or workflow callers that forward an untrusted log filename can append agent stdout and stderr to arbitrary filesystem locations relative to the selected logging directory. This breaks the documented log-directory boundary without requiring symbolic links and can overwrite unrelated user files with agent output.
