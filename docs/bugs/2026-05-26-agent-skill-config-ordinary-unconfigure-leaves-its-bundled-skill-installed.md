# Agent skill config ordinary unconfigure leaves its bundled skill installed

## Summary

The exported `@poe-code/agent-skill-config` `configure()` function writes the bundled `poe-generate.md` skill into an agent skill directory, but its matching `unconfigure()` call without `force: true` removes only empty directories. A normal configure/unconfigure lifecycle therefore leaves Poe Code's own installed skill file in place.

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
import { configure, unconfigure } from "./apply.js";

describe("agent skill unconfigure lifecycle probe", () => {
  it("removes the bundled skill written by ordinary configure", async () => {
    const homeDir = "/home/test";
    const cwd = "/repo";
    const volume = Volume.fromJSON({}, "/");
    volume.mkdirSync(homeDir, { recursive: true });
    volume.mkdirSync(cwd, { recursive: true });
    const fs = createFsFromVolume(volume).promises as unknown as FileSystem;

    await configure("claude-code", { fs, homeDir, cwd });
    await unconfigure("claude-code", { fs, homeDir, cwd });

    await expect(fs.stat(`${homeDir}/.claude/skills/poe-generate.md`)).rejects.toThrow();
  });
});
```

Run the focused probe and remove it:

```sh
npm exec -- vitest run packages/agent-skill-config/src/__probe__.test.ts --reporter verbose
rm packages/agent-skill-config/src/__probe__.test.ts
```

## Observed Behavior

- `configure("claude-code", ...)` creates `~/.claude/skills/poe-generate.md`.
- Calling the matching `unconfigure("claude-code", ...)` with ordinary default options resolves without deleting that file.
- The probe fails because `fs.stat("~/.claude/skills/poe-generate.md")` resolves to a file stat instead of rejecting as absent.

## Expected Behavior

Unconfiguring agent skills should remove the skill files installed by the matching configure operation without requiring recursive deletion of unrelated user-owned files in the same directory.

## Impact

- Users cannot undo a normal skill configuration through the normal unconfigure API or CLI flow unless they opt into forceful removal of the entire shared skill directory.
- Poe Code-provided instructions remain active for the agent after an apparent unconfiguration attempt.
- The only deletion mode that removes the bundled file also risks deleting independently managed skills that share the directory.

## Supporting Evidence

In `packages/agent-skill-config/src/apply.ts`, `configure()` writes `poe-generate.md` into the selected skill root, while `unconfigure()` invokes only `fileMutation.removeDirectory({ path: skillDir, force: options.force })` and has no mutation removing its owned bundled file. The existing behavior of `removeDirectory` leaves non-empty directories untouched unless forced. In `src/cli/commands/skill.ts`, the ordinary `skill unconfigure` command passes `force: Boolean(options.force)`, so the default user path reaches the non-removing behavior.
