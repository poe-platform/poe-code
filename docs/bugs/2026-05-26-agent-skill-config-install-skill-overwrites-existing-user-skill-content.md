# Agent skill config installSkill overwrites existing user skill content

## Summary

The exported `@poe-code/agent-skill-config` `installSkill()` API silently replaces an existing user-authored `SKILL.md` when the requested install name already exists in the selected agent skill directory.

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
import { installSkill } from "./apply.js";

describe("installSkill existing target ownership probe", () => {
  it("preserves a user-authored skill folder with the requested install name", async () => {
    const homeDir = "/home/test";
    const cwd = "/repo";
    const existingPath = `${cwd}/.claude/skills/custom/SKILL.md`;
    const volume = Volume.fromJSON({ [existingPath]: "# user version\n" }, "/");
    volume.mkdirSync(homeDir, { recursive: true });
    volume.mkdirSync(cwd, { recursive: true });
    const fs = createFsFromVolume(volume).promises as unknown as FileSystem;

    await installSkill("claude-code", { name: "custom", content: "# installed version\n" }, {
      fs,
      cwd,
      homeDir,
      scope: "local"
    });

    await expect(fs.readFile(existingPath, "utf8")).resolves.toBe("# user version\n");
  });
});
```

Run the focused probe and remove it:

```sh
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
rm packages/agent-skill-config/src/__probe__.test.ts
```

## Observed Behavior

- Before installation, `.claude/skills/custom/SKILL.md` contains `# user version`.
- Calling `installSkill(..., { name: "custom", content: "# installed version" }, ...)` resolves successfully.
- The existing file is replaced with `# installed version`, and the probe fails because the original user content is gone.

## Expected Behavior

Installing a named skill should not silently overwrite an existing untracked skill at the same destination. The API should reject the collision, require explicit replacement intent, or preserve ownership/backup information sufficient to restore prior content.

## Impact

- Plan, pipeline, experiment, superintendent, terminal-pilot, or SDK-driven skill installers can destroy a user's existing same-named skill instructions.
- Installation success gives no warning that pre-existing behavior has been replaced.
- Untracked local skill customizations are irrecoverable through the installer API once overwritten.

## Supporting Evidence

In `packages/agent-skill-config/src/apply.ts`, `installSkill()` constructs `${skillFolderPath}/SKILL.md` directly from the requested skill name and invokes `templateMutation.write()` for that target. It performs no existence or ownership check before the shared template mutation writes replacement content to a previously existing file.
