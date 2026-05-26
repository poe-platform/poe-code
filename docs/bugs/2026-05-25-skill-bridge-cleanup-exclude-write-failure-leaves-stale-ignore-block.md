# Skill Bridge Cleanup Exclude Write Failure Leaves Stale Ignore Block

## Summary

The exported `@poe-code/agent-skill-config` `cleanupBridgedSkills()` function deletes copied bridge targets before rewriting `.git/info/exclude` to remove their generated ignore block. If that final exclude-file write rejects, cleanup fails after the transient skill content has already been removed while its ignore entry remains persisted in repository state.

## Reproduction

Create a disposable Vitest probe at `packages/agent-skill-config/src/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

let failExcludeWrite = false;

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs,
    writeFileSync(targetPath: string, data: string | Uint8Array, encoding?: BufferEncoding) {
      if (failExcludeWrite && targetPath === "/repo/.git/info/exclude") {
        throw new Error("exclude cleanup denied");
      }
      return fs.writeFileSync(targetPath, data, encoding);
    }
  };
});

const { bridgeActiveSkills, cleanupBridgedSkills } = await import("./bridge-active-skills.js");
const { setGitDirRunnerForTest } = await import("./git-exclude.js");

describe("skill bridge cleanup exclude failure", () => {
  beforeEach(() => {
    failExcludeWrite = false;
    vol.reset();
    vol.mkdirSync("/repo/.poe-code/skills/foo", { recursive: true });
    vol.mkdirSync("/home/test", { recursive: true });
    vol.writeFileSync("/repo/.poe-code/skills/foo/SKILL.md", "# foo\n");
  });

  it("removes bridged content but leaves its ignore block when cleanup rejects", () => {
    const restoreRunner = setGitDirRunnerForTest(() => "/repo/.git");
    try {
      const manifest = bridgeActiveSkills("opencode", "/repo", ["foo"], "/home/test", "run-1");
      failExcludeWrite = true;

      expect(() => cleanupBridgedSkills(manifest)).toThrow("exclude cleanup denied");
      expect(vol.existsSync("/repo/.opencode/skills/foo")).toBe(false);
      expect(vol.readFileSync("/repo/.git/info/exclude", "utf8")).toContain(
        ".opencode/skills/foo"
      );
    } finally {
      restoreRunner();
    }
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-skill-config/src/__probe__.test.ts > skill bridge cleanup exclude failure > removes bridged content but leaves its ignore block when cleanup rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`cleanupBridgedSkills()` is publicly exported at `packages/agent-skill-config/src/index.ts:33`. Its cleanup loop removes every copied target and created parent directory first, then calls `removeExcludeBlock()` at `packages/agent-skill-config/src/bridge-active-skills.ts:284` through `packages/agent-skill-config/src/bridge-active-skills.ts:293`. `removeExcludeBlock()` directly overwrites `.git/info/exclude` at `packages/agent-skill-config/src/git-exclude.ts:114` through `packages/agent-skill-config/src/git-exclude.ts:134`. In the probe, the final write throws `exclude cleanup denied`; `.opencode/skills/foo` is gone, but `.git/info/exclude` still contains `.opencode/skills/foo` in the generated block.

## Expected Behavior

Bridge cleanup should not leave persisted ignore metadata for content it has already removed. It should update ignore state before destructive target removal with rollback support, or preserve enough state to retry/reconcile cleanup without returning a partially completed teardown.

## Impact

A transient permission, disk, or filesystem failure during bridge teardown leaves stale generated entries in `.git/info/exclude` while reporting cleanup failure. Future files created at those paths are unexpectedly hidden from Git, generated blocks accumulate across failed cleanups, and callers cannot reconstruct the removed bridge content from the rejected operation.
