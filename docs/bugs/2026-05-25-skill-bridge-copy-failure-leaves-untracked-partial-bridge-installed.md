# Skill bridge copy failure leaves untracked partial bridge installed

## Summary

`@poe-code/agent-skill-config` bridges multiple active skills into a spawning agent's local skill directory by copying each target immediately, but it constructs the returned cleanup manifest and appends the Git exclude block only after all requested copies finish. If a later skill copy fails, `bridgeActiveSkills()` throws after earlier target directories have already been copied. No manifest is returned to the caller and no exclude entry identifies the stranded bridged content for cleanup.

## Reproduction

Create a disposable Vitest probe at `packages/agent-skill-config/src/__probe__.test.ts`:

```ts
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const nodeFs = await import("node:fs");
const { bridgeActiveSkills } = await import("./bridge-active-skills.js");
const { setGitDirRunnerForTest } = await import("./git-exclude.js");
const cwd = "/repo";
const homeDir = "/home/test";

function writeSkill(name: string): void {
  const directory = path.join(cwd, ".poe-code/skills", name);
  vol.mkdirSync(directory, { recursive: true });
  vol.writeFileSync(path.join(directory, "SKILL.md"), `# ${name}\n`);
}

describe("skill bridge copy failure probe", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(cwd, { recursive: true });
    vol.mkdirSync(homeDir, { recursive: true });
    setGitDirRunnerForTest(() => path.join(cwd, ".git"));
  });

  it("strands an earlier copied skill when a later target copy fails", () => {
    writeSkill("alpha");
    writeSkill("bravo");
    const originalCopy = nodeFs.copyFileSync;
    vi.spyOn(nodeFs, "copyFileSync").mockImplementation((source, target, mode) => {
      if (String(source).endsWith("bravo/SKILL.md")) {
        throw new Error("simulated second bridge copy failure");
      }
      originalCopy(source, target, mode);
    });

    expect(() => bridgeActiveSkills("opencode", cwd, ["alpha", "bravo"], homeDir, "run-1"))
      .toThrow("simulated second bridge copy failure");
    expect(vol.readFileSync(path.join(cwd, ".opencode/skills/alpha/SKILL.md"), "utf8"))
      .toBe("# alpha\n");
    expect(vol.existsSync(path.join(cwd, ".git/info/exclude"))).toBe(false);
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `packages/agent-skill-config/src/__probe__.test.ts` afterward.

## Observed Behavior

- Two project skills, `alpha` and `bravo`, are eligible for bridging into `.opencode/skills`.
- The injected copy function permits copying `alpha`, then rejects while copying `bravo`.
- `bridgeActiveSkills(...)` throws with `simulated second bridge copy failure`.
- After rejection, `.opencode/skills/alpha/SKILL.md` exists with the copied skill contents, but `.git/info/exclude` was never written.
- In `packages/agent-skill-config/src/bridge-active-skills.ts`, `copyDirectory()` is executed inside the per-source loop before the entry is finally returned to caller, while `appendExcludeBlock()` executes only after the loop completes; exceptions do not clean already copied targets or return a usable partial manifest.

## Expected Behavior

A failed multi-skill bridge operation should clean up all newly copied targets before throwing, or return a structured partial result that lets the caller perform reliable cleanup. Copied temporary bridge content should not be left installed without the associated tracking and ignore metadata.

## Impact

A filesystem failure on one requested skill can silently leave earlier bridged skills active in the spawning agent's local search path after the overall bridge setup reports failure. Because no manifest or exclude marker is produced, later automated cleanup cannot identify the stranded injection, and unintended skill instructions may remain visible in subsequent runs.
