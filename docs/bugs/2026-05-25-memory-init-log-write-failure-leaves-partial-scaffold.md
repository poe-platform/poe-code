# Memory initialization log write failure leaves partial scaffold

## Summary

The exported `@poe-code/memory` `initMemory()` API creates its required scaffold sequentially: it first creates `pages/`, then writes `INDEX.md`, and only afterward writes `LOG.md`. If creation of `LOG.md` fails, initialization rejects after leaving the directory and index durably created without the required log artifact.

## Reproduction

From the repository root, add a disposable probe at `packages/memory/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  const promises = fs.promises;
  return {
    ...promises,
    writeFile: async (targetPath: string, content: string, options: { encoding: string; flag: string }) => {
      if (targetPath.endsWith("/LOG.md")) {
        throw new Error("log scaffold failed");
      }
      await promises.writeFile(targetPath, content, options);
    }
  };
});

const { initMemory } = await import("./init.js");

describe("memory initialization partial scaffold repro", () => {
  afterEach(() => vol.reset());

  it("rejects after creating the pages directory and index without the log", async () => {
    await expect(initMemory("/repo/.poe-code/memory")).rejects.toThrow("log scaffold failed");

    await expect(vol.promises.stat("/repo/.poe-code/memory/pages")).resolves.toBeDefined();
    await expect(vol.promises.readFile("/repo/.poe-code/memory/INDEX.md", "utf8")).resolves.toBe(
      "# Memory index\n"
    );
    await expect(vol.promises.readFile("/repo/.poe-code/memory/LOG.md", "utf8")).rejects.toThrow();
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/memory/src/__probe__.test.ts > memory initialization partial scaffold repro > rejects after creating the pages directory and index without the log
```

Remove the disposable probe after validation.

## Observed Behavior

When `LOG.md` creation throws `log scaffold failed`, `initMemory()` rejects, but the memory root already contains a created `pages/` directory and the generated `INDEX.md` document. The required `LOG.md` file is absent because the function publishes each scaffold artifact before attempting the next one.

## Expected Behavior

A failed memory initialization should leave no newly initialized scaffold behind, or it should commit all required initialization artifacts as one durable state transition before reporting success.

## Impact

Transient storage or permission failures during initialization can leave memory in a partially created state that does not satisfy the scaffold contract. Subsequent retries and commands may observe an ambiguous mix of initialized and missing artifacts, and this partial state combines with existing initialization-status behavior to make recovery and diagnosis more difficult.
