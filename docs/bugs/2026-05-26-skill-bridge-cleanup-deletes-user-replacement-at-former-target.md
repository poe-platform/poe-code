# Skill bridge cleanup deletes user replacement at former target

## Summary

The exported `@poe-code/agent-skill-config` `cleanupBridgedSkills()` API deletes every target path recorded in a prior bridge manifest without confirming that the path still contains bridge-owned content. If the bridged skill is removed during the active run and a user creates a new real skill at the same target path, later cleanup recursively deletes that unrelated user replacement.

## Reproduction

Create the disposable probe `packages/agent-skill-config/src/__probe__.test.ts`:

```ts
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { bridgeActiveSkills, cleanupBridgedSkills } = await import("./bridge-active-skills.js");
const { setGitDirRunnerForTest } = await import("./git-exclude.js");

describe("skill bridge cleanup ownership", () => {
  const cwd = "/repo";
  const homeDir = "/home/test";
  let restoreRunner: () => void;

  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(path.join(cwd, ".poe-code/skills/foo"), { recursive: true });
    vol.writeFileSync(path.join(cwd, ".poe-code/skills/foo/SKILL.md"), "# bridge source\n");
    vol.mkdirSync(homeDir, { recursive: true });
    restoreRunner = setGitDirRunnerForTest(() => path.join(cwd, ".git"));
  });

  afterEach(() => restoreRunner());

  it("deletes a user replacement installed at a previously bridged target", () => {
    const manifest = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, "run-1");
    const target = path.join(cwd, ".opencode/skills/foo");

    vol.rmSync(target, { recursive: true });
    vol.mkdirSync(target, { recursive: true });
    vol.writeFileSync(path.join(target, "SKILL.md"), "# user replacement\n");

    cleanupBridgedSkills(manifest);

    console.log(`exists=${String(vol.existsSync(path.join(target, "SKILL.md")))}`);
    expect(vol.existsSync(path.join(target, "SKILL.md"))).toBe(false);
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-skill-config/src/__probe__.test.ts
```

## Observed Behavior

The probe passes and prints:

```text
exists=false
✓ packages/agent-skill-config/src/__probe__.test.ts > skill bridge cleanup ownership > deletes a user replacement installed at a previously bridged target
```

`bridgeActiveSkills()` records only the target path and created parent directories in each manifest entry after copying a source skill at `packages/agent-skill-config/src/bridge-active-skills.ts:257` through `packages/agent-skill-config/src/bridge-active-skills.ts:281`; it does not retain an ownership marker, inode identity, or content fingerprint. `cleanupBridgedSkills()` then loops over those stale path records and recursively removes each target through `removeTarget(entry.targetPath)` at `packages/agent-skill-config/src/bridge-active-skills.ts:284` through `packages/agent-skill-config/src/bridge-active-skills.ts:293`, regardless of whether the original bridge copy still exists. In the reproduction, a distinct user-created `SKILL.md` replaces the copied directory before cleanup and is still deleted.

## Expected Behavior

Cleanup should remove only content that it can verify remains owned by the corresponding bridge operation, or it should refuse deletion and surface a conflict when a target path has been replaced or modified after bridging. A manifest from an earlier transient copy must not authorize deletion of later user-installed skills at the same location.

## Impact

Interactive runs can destroy newly installed or manually edited local skills when bridge cleanup runs at the end of an agent session. A user or parallel process that replaces an active bridged skill path with permanent content can lose the replacement silently, and the subsequent disappearance appears as ordinary cleanup rather than destructive removal of user-owned instructions and assets.
