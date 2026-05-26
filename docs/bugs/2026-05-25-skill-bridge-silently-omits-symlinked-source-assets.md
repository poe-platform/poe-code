# Skill bridge silently omits symlinked source assets

## Summary

The exported `@poe-code/agent-skill-config` `bridgeActiveSkills()` API documents that it copies a resolved source skill folder into the spawning agent's native skill directory. However, its directory copier silently skips symbolic-link entries inside that source folder. A skill whose instructions or assets are linked files is reported as successfully bridged with no warnings while the bridged copy is incomplete.

## Reproduction

Create the disposable probe `packages/agent-skill-config/src/__probe__.test.ts`:

```ts
import path from "node:path";
import * as fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { bridgeActiveSkills } = await import("./bridge-active-skills.js");

describe("skill bridge linked source file", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("reports a successful bridge while silently omitting a symlinked skill asset", () => {
    const cwd = "/repo";
    const homeDir = "/home/test";
    const source = path.join(cwd, ".poe-code/skills/helper");
    vol.mkdirSync(source, { recursive: true });
    vol.writeFileSync(path.join(source, "SKILL.md"), "# helper\n");
    vol.writeFileSync(path.join(source, "instructions.md"), "linked instructions\n");
    fs.symlinkSync("instructions.md", path.join(source, "PROMPT.md"));

    const manifest = bridgeActiveSkills("opencode", cwd, ["helper"], homeDir, "probe");
    const target = path.join(cwd, ".opencode/skills/helper");
    const promptExists = vol.existsSync(path.join(target, "PROMPT.md"));
    console.log(JSON.stringify({ entries: manifest.entries.length, warnings: manifest.warnings, promptExists }));

    expect(manifest.entries).toHaveLength(1);
    expect(manifest.warnings).toEqual([]);
    expect(vol.existsSync(path.join(target, "SKILL.md"))).toBe(true);
    expect(promptExists).toBe(false);
  });
});
```

Run the targeted test and remove the probe afterward:

```sh
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-skill-config/src/__probe__.test.ts
```

The probe passes while showing a successful manifest and absent linked asset:

```text
{"entries":1,"warnings":[],"promptExists":false}
✓ packages/agent-skill-config/src/__probe__.test.ts > skill bridge linked source file > reports a successful bridge while silently omitting a symlinked skill asset
```

## Observed Behavior

The package README states that `bridgeActiveSkills()` copies each resolved source folder into the target agent's local skill directory. The recursive copier in `packages/agent-skill-config/src/bridge-active-skills.ts:115` iterates source entries and handles only `dirent.isDirectory()` and `dirent.isFile()` at `packages/agent-skill-config/src/bridge-active-skills.ts:121` and `packages/agent-skill-config/src/bridge-active-skills.ts:126`. A symbolic-link entry matches neither branch and is skipped without error or warning. The bridge then unconditionally records the target as an installed entry at `packages/agent-skill-config/src/bridge-active-skills.ts:255` through `packages/agent-skill-config/src/bridge-active-skills.ts:264`.

## Expected Behavior

The bridge should either preserve safe in-skill linked entries, copy their resolved content according to an explicit containment policy, or reject/report skills containing unsupported symbolic links. It must not claim a complete successful bridge while silently dropping source-folder contents.

## Impact

Skills commonly share prompts, references, templates, or assets through linked files. When such a skill is bridged for an agent spawn, required instructions can disappear without any warning, causing the spawned agent to run with an incomplete or materially different skill from the one selected. Users and orchestration code receive a successful manifest and cannot tell that the active runtime instructions were truncated.
