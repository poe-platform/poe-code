# Utils symlink agents link failure leaves legacy instructions renamed away

## Summary

The `poe-code utils symlink agents` migration for a repository containing only `CLAUDE.md` executes two filesystem operations in sequence: rename `CLAUDE.md` to canonical `AGENTS.md`, then create a compatibility symlink at `CLAUDE.md`. If symlink creation fails after the rename succeeds, `applySymlinkOps()` rejects while the legacy instructions path has already disappeared. The command reports failed setup after partially changing the repository's instruction-file layout.

## Reproduction

Create a disposable Vitest probe at `src/cli/commands/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import type { FileSystem } from "../../utils/file-system.js";
import { applySymlinkOps, type SymlinkOp } from "./utils-symlink-ops.js";

describe("utils symlink agents failure probe", () => {
  it("leaves CLAUDE.md renamed away when follow-up symlink creation fails", async () => {
    const volume = Volume.fromJSON({ "/repo/CLAUDE.md": "instructions\n" }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    const fs = {
      ...rawFs,
      symlink: async () => {
        throw new Error("simulated symlink creation failure");
      }
    } as unknown as FileSystem;
    const ops: SymlinkOp[] = [
      { kind: "rename", from: "/repo/CLAUDE.md", to: "/repo/AGENTS.md" },
      { kind: "symlink", target: "AGENTS.md", path: "/repo/CLAUDE.md" }
    ];

    await expect(applySymlinkOps(fs, ops, { dryRun: false, log: () => undefined }))
      .rejects.toThrow("simulated symlink creation failure");
    await expect(rawFs.readFile("/repo/AGENTS.md", "utf8")).resolves.toBe("instructions\n");
    await expect(rawFs.lstat("/repo/CLAUDE.md")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
```

Run the probe:

```sh
npm exec -- vitest run src/cli/commands/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `src/cli/commands/__probe__.test.ts` afterward.

## Observed Behavior

- The initial repository contains only `/repo/CLAUDE.md` with instruction content.
- The two migration operations produced by the agents-symlink workflow are applied with a filesystem that allows the rename but rejects the following symlink creation.
- `applySymlinkOps(...)` rejects with `simulated symlink creation failure`.
- After rejection, `/repo/AGENTS.md` contains the instruction content but `/repo/CLAUDE.md` no longer exists, so tools still looking for the legacy file no longer see any instructions.
- In `src/cli/commands/utils-symlink-agents.ts`, `planAgentsSymlink()` returns a `rename` operation followed by a `symlink` operation when only `CLAUDE.md` exists; `src/cli/commands/utils-symlink-ops.ts` executes operations sequentially without rollback if a later operation rejects.

## Expected Behavior

A failed migration should preserve the pre-existing legacy instructions path, or roll the rename back when it cannot create the compatibility symlink. A command that reports failure should not leave a partially migrated file layout requiring manual recovery.

## Impact

Permission restrictions, unsupported symlink behavior, or filesystem errors can cause the utility to reject while silently removing the legacy instruction entrypoint. Existing agent integrations that consume `CLAUDE.md` may stop receiving project instructions until users manually recreate the file or symlink.
