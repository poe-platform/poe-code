# Agent skill config configure overwrites user skill with bundled filename

## Summary

The exported `@poe-code/agent-skill-config` `configure()` function installs its bundled `poe-generate.md` file by overwriting any existing file at that path, even when the existing skill was authored by the user and is not tracked as Poe Code-owned state.

## Environment

- Date reproduced: 2026-05-26
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: focused Vitest probe using an in-memory filesystem

## Reproduction

Create a disposable probe at `packages/agent-skill-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "@poe-code/config-mutations";
import { configure } from "./apply.js";

describe("agent skill configure ownership probe", () => {
  it("preserves a pre-existing user skill with the bundled filename", async () => {
    const homeDir = "/home/test";
    const cwd = "/repo";
    const userSkillPath = `${homeDir}/.claude/skills/poe-generate.md`;
    const volume = Volume.fromJSON({ [userSkillPath]: "# user-owned skill\n" }, "/");
    volume.mkdirSync(homeDir, { recursive: true });
    volume.mkdirSync(cwd, { recursive: true });
    const fs = createFsFromVolume(volume).promises as unknown as FileSystem;

    await configure("claude-code", { fs, homeDir, cwd });

    await expect(fs.readFile(userSkillPath, "utf8")).resolves.toBe("# user-owned skill\n");
  });
});
```

Run the focused probe and remove it:

```sh
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
rm packages/agent-skill-config/src/__probe__.test.ts
```

## Observed Behavior

- Before configuration, `~/.claude/skills/poe-generate.md` contains the user-authored content `# user-owned skill`.
- After `configure("claude-code", ...)`, that file contains Poe Code's bundled `poe-generate` skill template instead.
- The probe fails because the original content is replaced rather than preserved or rejected as a conflict.

## Expected Behavior

Configuring bundled skills should not overwrite an existing untracked skill file. It should preserve the user's file, require explicit consent to replace it, or maintain ownership/backup state sufficient to restore it later.

## Impact

- Users can lose custom agent skill instructions merely by configuring Poe Code skills.
- A same-named skill created independently is silently replaced without warning or recovery metadata.
- Combined with default unconfigure leaving the bundled file installed, the user's overwritten content is neither retained nor restored by the lifecycle.

## Supporting Evidence

In `packages/agent-skill-config/src/apply.ts`, `configure()` unconditionally creates a `templateMutation.write()` for `${skillDir}/poe-generate.md`. In `packages/config-mutations/src/execution/apply-mutation.ts`, the template-write mutation reads any previous content only to compare it, then writes the bundled rendered content directly to the same target when it differs; it performs no ownership check or preservation step for a user-created file.
