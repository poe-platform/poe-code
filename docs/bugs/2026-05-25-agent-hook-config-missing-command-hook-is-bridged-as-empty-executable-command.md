# Agent hook config missing command hook is bridged as empty executable command

## Summary

The exported `@poe-code/agent-hook-config` bridge reads Claude hook JSON without validating handler shape and transforms a supported `{ type: "command" }` handler that omits `command` into an installed Codex hook with `command: ""`. The bridge reports no dropped entry or validation failure while publishing a command hook that cannot launch the intended action.

## Reproduction

Create a disposable Vitest probe at `packages/agent-hook-config/src/__probe__.test.ts`:

```ts
import * as fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { bridgeHooks } = await import("./bridge-hooks.js");
const { setGitDirRunnerForTest } = await import("../../agent-skill-config/src/git-exclude.js");

const cwd = "/repo";
const homeDir = "/home/test";
const sourcePath = path.join(cwd, ".claude/settings.json");
const targetPath = path.join(cwd, ".codex/hooks.json");

describe("hook bridge missing command", () => {
  let restore: (() => void) | undefined;
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(path.dirname(sourcePath), { recursive: true });
    vol.writeFileSync(sourcePath, JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: "command" }] }] }
    }));
    restore = setGitDirRunnerForTest(() => path.join(cwd, ".git"));
  });
  afterEach(() => restore?.());

  it("installs a supported command hook with no command as an empty executable command", () => {
    const manifest = bridgeHooks("claude-code", "codex", cwd, homeDir, "probe", {
      scope: "project"
    });
    const written = JSON.parse(fs.readFileSync(targetPath, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command?: string }> }>>;
    };
    const installed = written.hooks.PreToolUse?.[0]?.hooks[0];

    console.log(JSON.stringify({ drops: manifest.drops, installed }));
    expect(manifest.drops).toEqual([]);
    expect(installed).toMatchObject({ type: "command", command: "" });
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-hook-config/src/__probe__.test.ts
```

## Observed Behavior

The malformed source handler is accepted and published as an empty command, with no reported drop:

```text
{"drops":[],"installed":{"type":"command","command":"","statusMessage":"[generated:probe] "}}
✓ packages/agent-hook-config/src/__probe__.test.ts > hook bridge missing command > installs a supported command hook with no command as an empty executable command
```

`readClaudeHooks()` in `packages/agent-hook-config/src/read-hooks.ts` casts parsed JSON to `ClaudeSettings` and copies handlers into the bridge input without checking that a `command` handler contains a non-empty `command` string. `transformHooks()` in `packages/agent-hook-config/src/transform-hooks.ts` accepts the handler solely because its `type` is supported, then creates the generated command using `sourceEntry.handler.command ?? ""`. `bridgeHooks()` subsequently writes that generated entry into `.codex/hooks.json` as ordinary installed hook configuration.

## Expected Behavior

Hook bridging should reject or explicitly drop malformed source command handlers that omit a non-empty command value. It should not silently install a generated executable hook whose command is empty while reporting a successful transform with no drops.

## Impact

Hand-edited, corrupted, or tool-generated Claude hook settings can be bridged into Codex as apparently valid generated hooks that perform no intended command execution. Users receive no actionable validation error during configuration, and later hook invocations can silently fail to enforce checks, notifications, or automation expected from the migrated hook.
