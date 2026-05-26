# Skill bridge symlinked project source directory imports external instructions

## Summary

The exported `@poe-code/agent-skill-config` `bridgeActiveSkills()` API resolves a bare skill reference from the project-local `.poe-code/skills` directory, but does not verify that the resolved source directory remains inside the project. If `.poe-code/skills/<name>` is a symbolic link to an external directory, the bridge copies external `SKILL.md` instructions into the spawning agent's local skill directory while recording the source as a project-local path.

## Reproduction

Create the disposable probe `packages/agent-skill-config/src/__probe__.test.ts`:

```ts
import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { bridgeActiveSkills } = await import("./bridge-active-skills.js");
const { setGitDirRunnerForTest } = await import("./git-exclude.js");

describe("skill bridge linked source directory", () => {
  let restoreRunner: () => void;

  beforeEach(() => {
    vol.reset();
    restoreRunner = setGitDirRunnerForTest(() => "/repo/.git");
  });

  afterEach(() => {
    restoreRunner();
  });

  it("loads external instructions through a project-scoped skill symlink", () => {
    vol.mkdirSync("/repo/.poe-code/skills", { recursive: true });
    vol.mkdirSync("/outside/helper", { recursive: true });
    vol.writeFileSync("/outside/helper/SKILL.md", "# external instruction\n");
    fs.symlinkSync("/outside/helper", "/repo/.poe-code/skills/helper");

    const manifest = bridgeActiveSkills("opencode", "/repo", ["helper"], "/home/test", "probe");
    const copied = vol.readFileSync("/repo/.opencode/skills/helper/SKILL.md", "utf8");
    console.log(JSON.stringify({ sourcePath: manifest.entries[0]?.sourcePath, copied }));

    expect(manifest.entries[0]?.sourcePath).toBe("/repo/.poe-code/skills/helper");
    expect(copied).toBe("# external instruction\n");
  });
});
```

Run the targeted test, then delete the disposable probe:

```sh
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-skill-config/src/__probe__.test.ts
```

The probe passes and prints a project-looking manifest path paired with external copied content:

```text
{"sourcePath":"/repo/.poe-code/skills/helper","copied":"# external instruction\n"}
✓ packages/agent-skill-config/src/__probe__.test.ts > skill bridge linked source directory > loads external instructions through a project-scoped skill symlink
```

## Observed Behavior

Bare skill resolution builds the candidate project source path using lexical `path.resolve(cwd, ".poe-code/skills", ref)` in `packages/agent-skill-config/src/resolve-skill-reference.ts:81` through `packages/agent-skill-config/src/resolve-skill-reference.ts:92`. `findSkill()` accepts it whenever `statSync(targetPath).isDirectory()` succeeds, which follows a symbolic-link directory without canonical containment validation. `bridgeActiveSkills()` then calls `copyDirectory(item.source.sourcePath, item.targetPath)` in `packages/agent-skill-config/src/bridge-active-skills.ts:255` through `packages/agent-skill-config/src/bridge-active-skills.ts:264`, copying the external linked directory's instructions into the active spawned-agent skill location.

## Expected Behavior

A project-scoped skill reference should resolve and bridge instructions only from a canonical directory contained beneath the project-local skill root. A source directory symlink that escapes that root should be rejected or explicitly surfaced as external before its contents are activated for an agent spawn.

## Impact

A crafted checkout or stale project symlink can make an apparently local active skill inject arbitrary instructions or assets from outside the repository into a spawned agent's runtime context. Users and orchestration receive a manifest naming a project-local skill source even though the executed skill content originates externally, undermining reviewability and workspace trust boundaries.
