# Agent Maestro startup cleanup symlinked root deletes external workspace

## Summary

`agent-maestro` startup cleanup follows a configured workspace-root symbolic link and recursively removes terminal-task directories from its external target. This turns ordinary startup housekeeping into deletion outside the configured lexical workspace location.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/agent-maestro/src/__probe__.test.ts <<'PROBE'
import { mkdtemp, mkdir, symlink, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startupTerminalCleanup } from "./workspace/manager.js";

describe("symlinked workspace root startup cleanup", () => {
  it("deletes an external terminal workspace through the configured root symlink", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "maestro-cleanup-probe-"));
    const configuredRoot = path.join(base, "configured");
    const externalRoot = path.join(base, "external");
    await mkdir(path.join(externalRoot, "done"), { recursive: true });
    await symlink(externalRoot, configuredRoot);
    const result = await startupTerminalCleanup(configuredRoot, ["done"]);
    let externalExists = true;
    try { await stat(path.join(externalRoot, "done")); } catch { externalExists = false; }
    console.log(JSON.stringify({ result, externalExists }));
    expect(result).toEqual({ removed: 1 });
    expect(externalExists).toBe(false);
  });
});
PROBE
npm exec -- vitest run packages/agent-maestro/src/__probe__.test.ts --reporter verbose
rm packages/agent-maestro/src/__probe__.test.ts
```

Output:

```text
{"result":{"removed":1},"externalExists":false}
✓ packages/agent-maestro/src/__probe__.test.ts > symlinked workspace root startup cleanup > deletes an external terminal workspace through the configured root symlink
```

## Observed Behavior

A configured workspace path that is itself a symbolic link to an external directory is accepted as a directory. `startupTerminalCleanup()` at `packages/agent-maestro/src/workspace/manager.ts:30` through `packages/agent-maestro/src/workspace/manager.ts:54` reads entries through that symlink and invokes recursive removal on `path.join(root, entry.name)`, deleting the matched `done` directory in the external target.

## Expected Behavior

Cleanup should operate only beneath the canonical configured workspace root and should reject or safely avoid a root symlink that escapes that location before any recursive deletion occurs.

## Impact

A stale, malicious, or accidentally redirected workspace-root symlink can cause starting Maestro to remove external directories that match terminal task workspace names. This is a destructive deletion boundary distinct from an active driver writing through a symlinked task workspace.
