# Process launcher restart trusts persisted spec ID and redirects launch

## Summary

The exported `@poe-code/process-launcher` `restartManagedProcess()` API loads a managed process from the caller-requested directory but then trusts the `id` field inside the stored `spec.json` document. If that field does not match the requested process ID, restarting one stopped process writes and launches a different managed-process directory instead.

## Reproduction

From the repository root, create and execute this disposable in-memory Vitest probe, then remove it:

```sh
cat > packages/process-launcher/src/__probe__.test.ts <<'EOF'
import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { expect, it, vi } from "vitest";
import { restartManagedProcess, type LauncherFileSystem } from "@poe-code/process-launcher";

it("restarts the persisted spec id instead of the requested process id", async () => {
  const baseDir = "/launch";
  const rawFs = createFsFromVolume(
    Volume.fromJSON({
      [path.join(baseDir, "requested", "spec.json")]: JSON.stringify({
        id: "redirected",
        command: "server",
        restart: "never"
      }),
      [path.join(baseDir, "requested", "state.json")]: JSON.stringify({
        id: "requested",
        command: "server",
        args: [],
        runtime: "host",
        pid: null,
        status: "stopped",
        restartCount: 0,
        lastExitCode: null,
        lastStartedAt: null,
        lastStoppedAt: null
      }),
      [path.join(baseDir, "requested", "meta.json")]: JSON.stringify({ daemonPid: null })
    }, "/")
  ).promises;
  const fs = rawFs as unknown as LauncherFileSystem;
  const spawnDaemon = vi.fn(async () => null);

  const result = await restartManagedProcess({
    baseDir,
    fs,
    id: "requested",
    spawnDaemon
  });

  expect(spawnDaemon).toHaveBeenCalledWith("redirected");
  expect(result.spec?.id).toBe("redirected");
  await expect(rawFs.readFile(path.join(baseDir, "redirected", "spec.json"), "utf8"))
    .resolves.toContain('"id": "redirected"');
  await expect(rawFs.readFile(path.join(baseDir, "requested", "spec.json"), "utf8"))
    .resolves.toContain('"id":"redirected"');
});
EOF
npm exec -- vitest run packages/process-launcher/src/__probe__.test.ts --reporter verbose
rm packages/process-launcher/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/process-launcher/src/__probe__.test.ts > restarts the persisted spec id instead of the requested process id
Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

Calling `restartManagedProcess({ id: "requested" })` with `/launch/requested/spec.json` containing `{ "id": "redirected", ... }` invokes `spawnDaemon("redirected")` and creates `/launch/redirected/spec.json`. The original `/launch/requested/spec.json` still contains the mismatched stored identity, so the restart request does not restart the record identified by the requested directory.

`restartManagedProcess()` reads the record using `options.id` at `packages/process-launcher/src/launcher.ts:185`, then passes the loaded `record.spec` directly to `startManagedProcess()` at `packages/process-launcher/src/launcher.ts:211`. `startManagedProcess()` derives all subsequent write paths and the daemon-spawn argument from `spec.id` at `packages/process-launcher/src/launcher.ts:86` through `packages/process-launcher/src/launcher.ts:101`. The `readSpec()` path at `packages/process-launcher/src/launcher.ts:556` through `packages/process-launcher/src/launcher.ts:560` parses JSON without checking that its stored ID matches the directory that was requested.

## Expected Behavior

Restarting a managed process by ID should operate only on that process. Persisted specifications should be validated against their containing/requested process ID, rejecting identity mismatches rather than using the embedded field to select a new launch target.

## Impact

A malformed or modified persisted `spec.json` can turn an operator's restart of one stopped managed process into the creation and launch of another process identity. This breaks lifecycle integrity, leaves the requested record unrepaired, and can cause an unexpected command or runtime configuration to be started under a different managed-process directory.
