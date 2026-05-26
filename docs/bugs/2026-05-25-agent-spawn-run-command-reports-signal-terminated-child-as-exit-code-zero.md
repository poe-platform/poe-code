# Agent spawn command runner reports signal-terminated child as exit code zero

## Summary

The exported `runCommand()` helper in `@poe-code/agent-spawn` reports a command killed by a signal as a successful result with `exitCode: 0`. Node supplies `code === null` when a child is terminated by a signal, but the helper substitutes zero, concealing failed or interrupted subprocesses from callers.

## Reproduction

1. From the repository root, create a temporary executable that kills itself and a disposable Vitest probe:

   ```sh
   probe_dir=$(mktemp -d /tmp/agent-spawn-command-probe.XXXXXX)
   cat > "$probe_dir/killed-command" <<'EOF'
   #!/bin/sh
   kill -TERM $$
   EOF
   chmod +x "$probe_dir/killed-command"

   cat > packages/agent-spawn/src/__probe__.test.ts <<EOF
   import { describe, expect, it } from "vitest";
   import { runCommand } from "./run-command.js";

   describe("runCommand killed child", () => {
     it("reports a signal-terminated command as exit code zero", async () => {
       await expect(runCommand("$probe_dir/killed-command", [])).resolves.toMatchObject({ exitCode: 0 });
     });
   });
   EOF
   ```

2. Run the probe and remove it afterward:

   ```sh
   npm exec -- vitest run packages/agent-spawn/src/__probe__.test.ts --reporter verbose
   rm -f packages/agent-spawn/src/__probe__.test.ts
   rm -rf "$probe_dir"
   ```

3. The disposable probe passes:

   ```text
   ✓ packages/agent-spawn/src/__probe__.test.ts > runCommand killed child > reports a signal-terminated command as exit code zero

   Test Files  1 passed (1)
        Tests  1 passed (1)
   ```

## Observed Behavior

`runCommand()` resolves `{ exitCode: 0 }` for a child process terminated with `SIGTERM`. Its `close` listener at `packages/agent-spawn/src/run-command.ts:72` through `packages/agent-spawn/src/run-command.ts:77` maps the `null` exit status emitted for signal termination to zero without examining the signal argument.

## Expected Behavior

The command runner should expose a non-success result, or reject, when a child terminates because of a signal. A subprocess that never exits successfully must not be indistinguishable from one that completed with status zero.

## Impact

Any consumer using the exported `runCommand()` helper for subprocess execution can silently accept killed commands as successful work. Provider setup, discovery, or other command-backed integrations may proceed with missing output or incomplete side effects while reporting a successful exit status.
