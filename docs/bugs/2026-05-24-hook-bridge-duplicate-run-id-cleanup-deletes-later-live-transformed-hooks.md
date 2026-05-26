# Hook bridge duplicate run ID cleanup deletes later live transformed hooks

## Summary

`@poe-code/agent-hook-config` accepts caller-provided `runId` values as the ownership identity for transformed hook output. When an earlier bridge and a later still-active bridge reuse the same identifier, cleanup of the earlier manifest removes the later bridge's generated hook handlers and its `.git/info/exclude` bookkeeping, even when the earlier bridge generated no executable handler itself.

## Reproduction

From the repository root, run this disposable Vitest probe. It deliberately makes the first bridge contain only an unsupported event, so no previously installed generated handler exists for the later write to replace; the only destructive operation under test is stale cleanup using a reused `runId`.

```sh
cat > packages/agent-hook-config/src/__probe__.test.ts <<'EOF'
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { bridgeHooks, cleanupBridgedHooks } = await import("./index.js");
const { setGitDirRunnerForTest } = await import("../../agent-skill-config/src/git-exclude.js");

const cwd = "/repo/project";
const homeDir = "/home/tester";
const sourcePath = path.join(cwd, ".claude/settings.json");
const targetPath = path.join(cwd, ".codex/hooks.json");
const excludePath = path.join(cwd, ".git/info/exclude");

function writeSource(hooks: Record<string, unknown>): void {
  vol.mkdirSync(path.dirname(sourcePath), { recursive: true });
  vol.writeFileSync(sourcePath, JSON.stringify({ hooks }), "utf8");
}

describe("duplicate hook bridge run identifiers", () => {
  let restoreRunner: (() => void) | undefined;

  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(cwd, { recursive: true });
    restoreRunner = setGitDirRunnerForTest(() => path.join(cwd, ".git"));
  });

  afterEach(() => {
    restoreRunner?.();
  });

  it("lets cleanup of an empty run delete a later live run with the same id", () => {
    writeSource({ SessionEnd: [{ hooks: [{ type: "command", command: "dropped" }] }] });
    const first = bridgeHooks("claude-code", "codex", cwd, homeDir, "same-run", {
      scope: "project"
    });

    writeSource({ PreToolUse: [{ hooks: [{ type: "command", command: "still-live" }] }] });
    bridgeHooks("claude-code", "codex", cwd, homeDir, "same-run", { scope: "project" });

    cleanupBridgedHooks(first);

    const exclude = vol.readFileSync(excludePath, "utf8") as string;
    const result = { targetExists: vol.existsSync(targetPath), exclude };
    console.log(JSON.stringify(result));
    expect(result).toEqual({ targetExists: false, exclude: "" });
  });
});
EOF
trap 'rm -f packages/agent-hook-config/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The first manifest's cleanup removes the hook file containing the second active bridge's `still-live` handler and removes both duplicate marker blocks from the Git exclude file:

```text
{"targetExists":false,"exclude":""}
✓ packages/agent-hook-config/src/__probe__.test.ts > duplicate hook bridge run identifiers > lets cleanup of an empty run delete a later live run with the same id
```

`bridgeHooks()` writes transformed handlers marked with the supplied `runId` and appends a hook exclude block bearing the same identity in `packages/agent-hook-config/src/bridge-hooks.ts:202`. `cleanupBridgedHooks()` then deletes every handler beginning with `[generated:<manifest.runId>]` in `packages/agent-hook-config/src/bridge-hooks.ts:248` and calls `removeExcludeBlock()` using only that identifier in `packages/agent-hook-config/src/bridge-hooks.ts:287`. `removeBlock()` deletes all complete blocks with matching marker lines in `packages/agent-skill-config/src/git-exclude.ts:59`.

## Expected Behavior

Cleanup should remove only transformed handlers and ignore entries owned by the manifest being cleaned. Duplicate caller-provided run identifiers should be rejected, disambiguated with a unique bridge ownership token, or cleaned by exact manifest-owned output so that an older manifest cannot remove a later active bridge.

## Impact

If concurrent, retried, or recycled spawns reuse a hook bridge identifier, completion of an older run can silently disable hooks still required by a live agent and expose the generated hook path to ordinary Git status or commits. Safety checks and workflow automation can disappear after unrelated cleanup while the affected spawn remains active.
