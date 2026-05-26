# Agent skill config bare dot reference bridges entire project skill root

## Summary

The exported `@poe-code/agent-skill-config` `bridgeActiveSkills()` API accepts the bare skill reference `.` as a valid skill name. Instead of selecting one project-local skill folder, path normalization resolves it to the `.poe-code/skills` root itself, and the bridge recursively copies every skill beneath that root into the spawning agent's local skill directory while recording a single requested reference.

## Reproduction

Create the disposable probe `packages/agent-skill-config/src/__probe__.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { bridgeActiveSkills } = await import("./bridge-active-skills.js");
const { setGitDirRunnerForTest } = await import("./git-exclude.js");

describe("bridge bare dot skill reference", () => {
  let restoreRunner: () => void;

  beforeEach(() => {
    vol.reset();
    vol.mkdirSync("/repo/.git/info", { recursive: true });
    vol.mkdirSync("/repo/.poe-code/skills/alpha", { recursive: true });
    vol.mkdirSync("/repo/.poe-code/skills/bravo", { recursive: true });
    vol.writeFileSync("/repo/.poe-code/skills/alpha/SKILL.md", "# alpha\n");
    vol.writeFileSync("/repo/.poe-code/skills/bravo/SKILL.md", "# bravo\n");
    restoreRunner = setGitDirRunnerForTest(() => "/repo/.git");
  });

  afterEach(() => {
    restoreRunner?.();
  });

  it("copies every project skill when only dot is requested", () => {
    const manifest = bridgeActiveSkills("opencode", "/repo", ["."], "/home/test", "run-1");
    const alpha = vol.readFileSync("/repo/.opencode/skills/alpha/SKILL.md", "utf8") as string;
    const bravo = vol.readFileSync("/repo/.opencode/skills/bravo/SKILL.md", "utf8") as string;
    console.log(JSON.stringify({ entries: manifest.entries, alpha, bravo }));

    expect(manifest.entries).toHaveLength(1);
    expect(alpha).toBe("# alpha\n");
    expect(bravo).toBe("# bravo\n");
  });
});
```

Run the targeted test, then delete the probe:

```sh
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-skill-config/src/__probe__.test.ts
```

The probe passes and prints one accepted reference whose copied target contains two distinct source skills:

```text
{"entries":[{"ref":".","sourcePath":"/repo/.poe-code/skills","targetPath":"/repo/.opencode/skills","createdParents":["/repo/.opencode"]}],"alpha":"# alpha\n","bravo":"# bravo\n"}
✓ packages/agent-skill-config/src/__probe__.test.ts > bridge bare dot skill reference > copies every project skill when only dot is requested
```

## Observed Behavior

For bare references, `resolveSkillReference()` checks only emptiness and surrounding whitespace at `packages/agent-skill-config/src/resolve-skill-reference.ts:64` through `packages/agent-skill-config/src/resolve-skill-reference.ts:93`, then builds the source path with `path.resolve(cwd, ".poe-code/skills", ref)`. For `ref = "."`, that resolves to the entire project skill root. `bridgeActiveSkills()` uses the same normalized name to derive the destination and recursively copies the resolved directory through `packages/agent-skill-config/src/bridge-active-skills.ts:115` through `packages/agent-skill-config/src/bridge-active-skills.ts:129` and `packages/agent-skill-config/src/bridge-active-skills.ts:192` through `packages/agent-skill-config/src/bridge-active-skills.ts:292`. One requested reference therefore installs both `alpha` and `bravo` into `.opencode/skills`.

## Expected Behavior

Active-skill references should identify exactly one named skill directory. The resolver should reject `.` and other non-name path components before path construction, rather than treating the entire configured skill collection as one bridgeable skill.

## Impact

Callers selecting a single active skill can accidentally or maliciously activate every local project skill for the spawned agent. This expands agent instructions and capabilities beyond the requested set, can expose unrelated skill content to a run, and makes the manifest misleading because it records one reference while multiple independent skills become available in the target agent directory.
