# Hook bridge later run removes hooks from live earlier run

## Summary

`@poe-code/agent-hook-config` documents transformed hooks as per-run entries whose marker-based cleanup allows concurrent runs not to interfere. However, each `writeCodexHooks()` call removes every previously generated handler in the target hook file before appending the new run's handlers. Starting a second transformed bridge therefore disables hooks required by an earlier still-running spawned agent.

## Reproduction

From the repository root, run a disposable Vitest probe that writes transformed Codex hook entries for two overlapping runs into the same project hook file:

```sh
cat > packages/agent-hook-config/src/__probe__.test.ts <<'EOF'
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeCodexHooks } from "./write-hooks.js";
import type { GeneratedHookEntry } from "./transform-hooks.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function entry(runId: string, command: string): GeneratedHookEntry {
  return {
    generatedId: `${runId}:${command}`,
    event: "Stop",
    handler: { type: "command", command, statusMessage: `[generated:${runId}] ${command}` }
  } as GeneratedHookEntry;
}

describe("overlapping transformed hook bridges", () => {
  it("removes hooks installed for an earlier live run when writing a later run", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hook-bridge-live-"));
    roots.push(root);
    const target = path.join(root, ".codex", "hooks.json");
    writeCodexHooks(target, [entry("run-1", "first")], "run-1");
    const second = writeCodexHooks(target, [entry("run-2", "second")], "run-2");
    const content = JSON.parse(fs.readFileSync(target, "utf8"));
    const commands = content.hooks.Stop[0].hooks.map((hook: { command: string }) => hook.command);
    console.log(JSON.stringify({ previousGeneratedRemoved: second.previousGeneratedRemoved, commands }));
    expect(second.previousGeneratedRemoved).toBe(1);
    expect(commands).toEqual(["second"]);
  });
});
EOF
trap 'rm -f packages/agent-hook-config/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
nl -ba packages/agent-hook-config/README.md | sed -n '1,34p'
nl -ba packages/agent-hook-config/src/write-hooks.ts | sed -n '20,74p;96,116p'
```

## Observed Behavior

Writing the second run reports that it removed one generated hook, and only the second command remains installed:

```text
{"previousGeneratedRemoved":1,"commands":["second"]}
✓ packages/agent-hook-config/src/__probe__.test.ts > overlapping transformed hook bridges > removes hooks installed for an earlier live run when writing a later run
```

The README describes the package as “per-run, per-spawn” and states that cleanup keys off the full run marker “so concurrent runs do not interfere” in `packages/agent-hook-config/README.md:1` and `packages/agent-hook-config/README.md:25`. In contrast, `isGeneratedHandler()` recognizes every generated handler using only the broad `[generated:` prefix, and `removeGeneratedHandlers()` deletes all such handlers in `packages/agent-hook-config/src/write-hooks.ts:56`. `writeCodexHooks()` ignores its `_runId` argument and invokes that global removal on every new write in `packages/agent-hook-config/src/write-hooks.ts:96`.

## Expected Behavior

Adding hooks for a new active run should preserve generated handlers belonging to other live runs. Run-specific cleanup should remove only hooks bearing that run's full marker, or transformed hook targets should be isolated per spawn.

## Impact

Parallel Codex spawns that rely on bridged Claude hooks can silently lose safety checks, audit hooks, or workflow automation as soon as a sibling run starts. Behavior becomes timing-dependent: a still-running agent may operate without the hooks that were installed for it, even though its own lifecycle has not ended.
