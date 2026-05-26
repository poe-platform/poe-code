# Agent Hook Config Cleanup Failed Rewrite Corrupts Preexisting Hook File

## Summary

`@poe-code/agent-hook-config` preserves user-authored Codex hooks during transformed bridge cleanup by removing generated handlers in memory and directly overwriting the live `.codex/hooks.json` file. If that cleanup write partially modifies the target and then rejects, `cleanupBridgedHooks()` reports failure only after corrupting the pre-existing hook file that it was meant to preserve.

## Reproduction

Create a disposable probe at `packages/agent-hook-config/src/__probe__.test.ts`:

```ts
import * as fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs: memoryFs } = await import("memfs");
  return memoryFs;
});

const { bridgeHooks, cleanupBridgedHooks } = await import("./index.js");
const { setGitDirRunnerForTest } = await import("../../agent-skill-config/src/git-exclude.js");

const cwd = "/repo/project";
const homeDir = "/home/tester";
const sourcePath = path.join(cwd, ".claude/settings.json");
const targetPath = path.join(cwd, ".codex/hooks.json");

describe("hook bridge cleanup target rewrite failure probe", () => {
  let restoreRunner: (() => void) | undefined;

  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(path.dirname(sourcePath), { recursive: true });
    vol.writeFileSync(
      sourcePath,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "generated" }] }] } })
    );
    vol.mkdirSync(path.dirname(targetPath), { recursive: true });
    vol.writeFileSync(
      targetPath,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "user" }] }] } })
    );
    restoreRunner = setGitDirRunnerForTest(() => undefined);
  });

  afterEach(() => {
    restoreRunner?.();
    vi.restoreAllMocks();
  });

  it("corrupts the pre-existing hook file when cleanup persistence fails", () => {
    const manifest = bridgeHooks("claude-code", "codex", cwd, homeDir, "run-1", {
      scope: "project"
    });
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, "writeFileSync").mockImplementation((filePath, data, options) => {
      if (String(filePath) === targetPath) {
        originalWriteFileSync(filePath, "{partial", options);
        throw new Error("cleanup target write failed");
      }
      return originalWriteFileSync(filePath, data, options);
    });

    expect(() => cleanupBridgedHooks(manifest)).toThrow("cleanup target write failed");
    expect(vol.readFileSync(targetPath, "utf8")).toBe("{partial");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
```

The probe passes, showing that a target hook file containing an existing user command becomes malformed text after transformed bridge cleanup attempts to remove generated handlers and its live rewrite rejects. Remove the disposable probe afterward.

## Observed Behavior

After a transformed bridge adds generated `Stop` handlers alongside the existing user `Stop` handler, `cleanupBridgedHooks(manifest)` attempts to publish the cleaned configuration back to `.codex/hooks.json`. The simulated partial write rejects with `cleanup target write failed`, and reading the target afterward returns `{partial` instead of the valid pre-existing user hook configuration.

## Expected Behavior

Cleanup that removes generated hooks while preserving user configuration should use an atomic replacement or retain a recoverable original document until publication succeeds. A failed cleanup must not destroy the valid user-authored hook state it is specifically responsible for retaining.

## Impact

A disk error, permissions change, or interrupted write during spawned-agent hook teardown can make Codex hook configuration unreadable and erase user automation alongside generated entries. Later agent sessions may fail to load hooks or silently stop executing user-required actions, while the cleanup call exposes only a generic failure after data loss has occurred.
