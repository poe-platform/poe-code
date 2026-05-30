---
name: "Toolcraft OpenAPI generation failure leaves mixed generated client and stale lock"
---

# Toolcraft OpenAPI generation failure leaves mixed generated client and stale lock

## Summary

`toolcraft-openapi` publishes generated command files sequentially and writes `openapi.lock` only after all generated-file writes and deletions complete. If a later generated output write fails after an earlier new module has been saved, the generator rejects while leaving a mixed client tree: new code from the updated specification exists beside an old index module and the lock still claims the prior specification. Publication of one generated client update is not transactional.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft-openapi/src/__probe__.test.ts`:

```ts
import { createHash } from "node:crypto";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runGenerateCli } from "./bin/generate.js";

function spec(paths: Record<string, unknown>): string {
  return JSON.stringify({
    openapi: "3.0.3",
    info: { title: "API", version: "1" },
    paths
  });
}

function services(fs: ReturnType<typeof createFsFromVolume>["promises"]) {
  return {
    cwd: "/repo",
    fs,
    fetch: vi.fn<typeof fetch>(),
    stdout: { write: () => true },
    stderr: { write: () => true }
  };
}

describe("OpenAPI generator partial publication probe", () => {
  it("leaves a new command module with old index and lock after a later write fails", async () => {
    const empty = spec({});
    const updated = spec({
      "/bots": {
        get: {
          operationId: "listBots",
          tags: ["bots"],
          responses: { "200": { description: "ok" } }
        }
      }
    });
    const volume = Volume.fromJSON({ "/repo/openapi.json": empty }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    await runGenerateCli(["node", "generate"], services(rawFs));
    const oldLock = await rawFs.readFile("/repo/openapi.lock", "utf8");
    await rawFs.writeFile("/repo/openapi.json", updated, "utf8");
    const failingFs = {
      ...rawFs,
      writeFile: async (filePath: string, contents: string, encoding: BufferEncoding) => {
        if (filePath === "/repo/src/generated/index.ts") {
          throw new Error("simulated generated-file failure");
        }
        await rawFs.writeFile(filePath, contents, encoding);
      }
    };

    await expect(runGenerateCli(["node", "generate"], services(failingFs))).rejects.toThrow(
      "simulated generated-file failure"
    );
    await expect(rawFs.readFile("/repo/src/generated/bots/list.ts", "utf8")).resolves.toContain(
      "listBots"
    );
    await expect(rawFs.readFile("/repo/src/generated/index.ts", "utf8")).resolves.toContain(
      "export {};"
    );
    await expect(rawFs.readFile("/repo/openapi.lock", "utf8")).resolves.toBe(oldLock);
    expect(oldLock).toContain(createHash("sha256").update(empty).digest("hex"));
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `packages/toolcraft-openapi/src/__probe__.test.ts` afterward.

## Observed Behavior

- The first generator run creates an empty generated client and a matching lock from an OpenAPI document with no operations.
- The source spec is changed to introduce the `listBots` command, and the injected filesystem rejects only when writing the updated `src/generated/index.ts`.
- The second generator invocation rejects with `simulated generated-file failure`.
- After rejection, the new `src/generated/bots/list.ts` module exists and contains `listBots`, but `src/generated/index.ts` still contains the prior empty-client `export {};` output and `openapi.lock` still contains the hash of the original empty specification.
- In `packages/toolcraft-openapi/src/bin/generate.ts`, `syncGeneratedClient()` calls `writeGeneratedFiles()` sequentially, then `deleteGeneratedFiles()`, and finally `writeOpenApiLock()`, without staging or rolling back the generated output set as a unit.

## Expected Behavior

A failed client regeneration should preserve the prior coherent generated client and lock, or atomically publish the complete new output set and matching lock together. It should not leave source modules from a new spec alongside a stale entrypoint and stale pin file.

## Impact

A disk or filesystem failure during routine regeneration can strand generated source in a contradictory state: code is present but not exported, deleted/renamed commands may be inconsistent, and the lock incorrectly indicates the old specification. Builds and reviews can silently consume a partial update until users manually repair or rerun generation.
