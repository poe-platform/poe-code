# Agent skill config parent reference bridges project state outside skill root

## Summary

The exported `@poe-code/agent-skill-config` `bridgeActiveSkills()` API accepts the bare active-skill reference `..`. Rather than selecting a skill directory, path normalization escapes `.poe-code/skills` to the parent `.poe-code` project-state directory and recursively copies that broader directory into the spawning agent's local configuration directory.

## Reproduction

Create and execute this disposable in-memory Vitest probe, then remove it:

```sh
cat > packages/agent-skill-config/src/__probe__.test.ts <<'EOF'
import path from "node:path";
import { expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { bridgeActiveSkills } = await import("./bridge-active-skills.js");
const { setGitDirRunnerForTest } = await import("./git-exclude.js");

it("bridges parent state outside the native skill root for a dot-dot reference", () => {
  const cwd = "/repo";
  const homeDir = "/home/test";
  vol.reset();
  vol.mkdirSync(path.join(cwd, ".poe-code/skills"), { recursive: true });
  vol.mkdirSync(homeDir, { recursive: true });
  vol.writeFileSync(path.join(cwd, ".poe-code/config.json"), '{"token":"secret"}\n');
  const restore = setGitDirRunnerForTest(() => path.join(cwd, ".git"));

  try {
    const manifest = bridgeActiveSkills("opencode", cwd, [".."], homeDir, "probe");

    expect(manifest.entries[0]).toMatchObject({
      ref: "..",
      sourcePath: path.join(cwd, ".poe-code"),
      targetPath: path.join(cwd, ".opencode")
    });
    expect(vol.readFileSync(path.join(cwd, ".opencode/config.json"), "utf8"))
      .toBe('{"token":"secret"}\n');
  } finally {
    restore();
  }
});
EOF
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
rm packages/agent-skill-config/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/agent-skill-config/src/__probe__.test.ts > bridges parent state outside the native skill root for a dot-dot reference
Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

With `/repo/.poe-code/config.json` present, `bridgeActiveSkills("opencode", "/repo", [".."], ...)` resolves the source as `/repo/.poe-code` and the destination as `/repo/.opencode`. It then copies `config.json` into `/repo/.opencode/config.json`, even though that file is project state rather than a requested skill asset.

`resolveSkillReference()` validates bare references only for emptiness and surrounding whitespace at `packages/agent-skill-config/src/resolve-skill-reference.ts:55` through `packages/agent-skill-config/src/resolve-skill-reference.ts:86`, then resolves them below `.poe-code/skills` with `path.resolve(...)`. For `ref = ".."`, this escapes to `.poe-code`. `bridgeActiveSkills()` later derives a target using the same unchecked `name` at `packages/agent-skill-config/src/bridge-active-skills.ts:180` through `packages/agent-skill-config/src/bridge-active-skills.ts:197`, so the destination likewise normalizes above `.opencode/skills`, and its recursive copy operation at `packages/agent-skill-config/src/bridge-active-skills.ts:111` through `packages/agent-skill-config/src/bridge-active-skills.ts:126` transfers the escaped directory contents.

## Expected Behavior

Active-skill references should identify exactly one directory contained beneath an allowed skill root. Parent-directory components such as `..` must be rejected before source or target path construction, and bridging must not copy project configuration directories outside the skill collection.

## Impact

A crafted active-skill selection can copy broader `.poe-code` project state—including configuration, credentials, caches, or run metadata stored beside `skills`—into another agent's visible configuration tree. This is more severe than bridging the entire skill collection: it escapes the intended asset root and can expose unrelated project-local state during an ordinary agent-spawn workflow.
