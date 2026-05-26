# Terminal Pilot uninstall global failure leaves local skill already removed

## Summary

`terminal-pilot uninstall` removes both local and global installations of its agent skill sequentially: it deletes the local skill folder first and then deletes the global folder. If global removal fails after local removal succeeds, the command rejects while leaving only the local installation deleted. The reported failed uninstall is therefore partially committed across the two supported installation scopes.

## Reproduction

Create a disposable Vitest probe at `packages/terminal-pilot/src/commands/__probe__.test.ts`:

```ts
import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { uninstall } from "./uninstall.js";

const HOME = "/home/test";
const CWD = "/project";

describe("terminal-pilot partial uninstall probe", () => {
  it("removes local skill before rejecting a failed global removal", async () => {
    const volume = Volume.fromJSON({
      [path.join(CWD, ".claude/skills/terminal-pilot/SKILL.md")]: "local",
      [path.join(HOME, ".claude/skills/terminal-pilot/SKILL.md")]: "global"
    }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    const fs = {
      ...rawFs,
      rm: async (folderPath: string, options?: { recursive?: boolean; force?: boolean }) => {
        if (folderPath === path.join(HOME, ".claude/skills/terminal-pilot")) {
          throw new Error("simulated global removal failure");
        }
        await rawFs.rm(folderPath, options);
      }
    };

    await expect(
      uninstall.handler({
        params: { agent: "claude-code" },
        fetch: globalThis.fetch,
        fs: { exists: async () => false, readFile: async () => "", writeFile: async () => undefined },
        env: { get: () => undefined },
        progress: () => undefined,
        secrets: {},
        terminalPilotInstaller: { cwd: CWD, homeDir: HOME, fs, platform: "darwin" }
      })
    ).rejects.toThrow("simulated global removal failure");
    await expect(rawFs.stat(path.join(CWD, ".claude/skills/terminal-pilot"))).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(rawFs.readFile(path.join(HOME, ".claude/skills/terminal-pilot/SKILL.md"), "utf8"))
      .resolves.toBe("global");
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/terminal-pilot/src/commands/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `packages/terminal-pilot/src/commands/__probe__.test.ts` afterward.

## Observed Behavior

- Both local and global Claude Code skill directories initially contain the terminal-pilot skill.
- The injected filesystem allows recursive deletion of the local folder, but rejects removal of the global folder.
- `uninstall.handler(...)` rejects with `simulated global removal failure`.
- After rejection, the local terminal-pilot skill directory no longer exists, while the global skill file remains installed.
- In `packages/terminal-pilot/src/commands/uninstall.ts`, the handler calls `removeSkillFolder()` for `localSkill.fullPath` and pushes its success before attempting `globalSkill.fullPath`, with no rollback or partial-result handling if the second call throws.

## Expected Behavior

An uninstall command covering both supported scopes should either complete removal of both installations, preserve both when it fails, or explicitly return a partial-removal result that callers can handle. A rejection should not silently mean that one scope was already removed.

## Impact

Filesystem or permission failures affecting the global skill folder can make a reported failed uninstall remove only the project-local integration. Users and automation may retry under the assumption that nothing changed, while projects unexpectedly lose their local terminal-pilot command instructions and the global install remains active.
