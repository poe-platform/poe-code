# Agent Hook Config Exclude Write Failure Leaves Untracked Generated Hooks Installed

## Summary

`@poe-code/agent-hook-config` bridges Claude hooks into Codex by first writing generated handlers into `.codex/hooks.json` and then appending a generated-file bookkeeping block to `.git/info/exclude`. If the final exclude write fails, `bridgeHooks()` throws after the executable generated hooks have already been installed, and it returns no cleanup manifest for removing that untracked bridge output.

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

const { bridgeHooks } = await import("./index.js");
const { setGitDirRunnerForTest } = await import("../../agent-skill-config/src/git-exclude.js");

const cwd = "/repo/project";
const homeDir = "/home/tester";
const sourcePath = path.join(cwd, ".claude/settings.json");
const targetPath = path.join(cwd, ".codex/hooks.json");
const excludePath = path.join(cwd, ".git/info/exclude");

describe("hook bridge exclude publication failure probe", () => {
  let restoreRunner: (() => void) | undefined;

  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(path.dirname(sourcePath), { recursive: true });
    vol.writeFileSync(
      sourcePath,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "notify" }] }] } })
    );
    restoreRunner = setGitDirRunnerForTest(() => path.join(cwd, ".git"));
  });

  afterEach(() => {
    restoreRunner?.();
    vi.restoreAllMocks();
  });

  it("rejects after generated hooks exist when exclude bookkeeping write fails", () => {
    const writeFileSync = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, "writeFileSync").mockImplementation((filePath, data, options) => {
      if (String(filePath) === excludePath) {
        throw new Error("exclude write failed");
      }
      return writeFileSync(filePath, data, options);
    });

    expect(() =>
      bridgeHooks("claude-code", "codex", cwd, homeDir, "run-1", { scope: "project" })
    ).toThrow("exclude write failed");
    expect(JSON.parse(vol.readFileSync(targetPath, "utf8") as string)).toMatchObject({
      hooks: { Stop: [{ hooks: [{ command: "notify", statusMessage: "[generated:run-1] " }] }] }
    });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that `.codex/hooks.json` contains a generated `Stop` hook after `bridgeHooks()` has rejected because `.git/info/exclude` could not be written. Remove the disposable probe afterward.

## Observed Behavior

`bridgeHooks("claude-code", "codex", ...)` rejects with `exclude write failed`, but the generated Codex handler with status marker `[generated:run-1] ` is already present in `.codex/hooks.json`. Since the operation throws before returning its `BridgeHookManifest`, the caller has no manifest to pass to `cleanupBridgedHooks()` for reliable removal.

## Expected Behavior

Hook bridging should either publish generated handlers and their bookkeeping atomically, roll back newly written handlers if ignore-bookkeeping publication fails, or return an explicit partial-install manifest on failure. A rejected bridge call should not leave executable generated hooks installed without cleanup tracking.

## Impact

Transient repository metadata write failures can silently leave spawned-agent hook commands active after setup reports failure. Later Codex sessions may execute unintended commands, generated hook files can appear as unexplained untracked changes, and automation cannot reliably clean the installed handler because the failed operation never returned its ownership manifest.
