# Memory Clear Index Recreation Failure Leaves Existing Memory Deleted

## Summary

The exported `@poe-code/memory` `clearMemory()` API deletes all existing memory content before it recreates the empty scaffold. If recreating `INDEX.md` fails, the operation rejects after the previous pages and audit log have already been irreversibly removed, leaving only a partial empty scaffold.

## Reproduction

Create a disposable probe at `packages/memory/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { clearMemory } = await import("./write.js");

describe("memory clear reinitialization failure probe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vol.reset();
  });

  it("rejects after deleting existing memory when empty index recreation fails", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Existing index\n",
      [`${root}/LOG.md`]: "- existing audit\n",
      [`${root}/pages/page.md`]: "# Existing page\n"
    });
    const originalWriteFile = vol.promises.writeFile.bind(vol.promises);
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (String(filePath) === `${root}/INDEX.md`) {
        throw new Error("injected index recreate failure");
      }
      return originalWriteFile(filePath, data, options);
    });

    await expect(clearMemory(root)).rejects.toThrow("injected index recreate failure");
    await expect(vol.promises.readFile(`${root}/pages/page.md`, "utf8")).rejects.toThrow();
    await expect(vol.promises.readFile(`${root}/LOG.md`, "utf8")).rejects.toThrow();
    await expect(vol.promises.readFile(`${root}/INDEX.md`, "utf8")).rejects.toThrow();
    await expect(vol.promises.stat(`${root}/pages`)).resolves.toBeDefined();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
```

The probe passes, demonstrating that existing memory is deleted before failed scaffold recreation is reported. Remove the disposable probe afterward.

## Observed Behavior

`clearMemory()` rejects with `injected index recreate failure`, but the pre-existing `pages/page.md`, `LOG.md`, and `INDEX.md` are already gone. The operation has recreated only the empty `pages/` directory before failing, so the previous memory content cannot be recovered through the rejected command.

## Expected Behavior

A failed clear operation should not destroy existing memory unless the requested empty replacement state can be successfully committed. Clearing should stage the replacement scaffold before deletion, retain a recoverable backup, or restore the previous content when scaffold initialization fails.

## Impact

A transient storage or permission failure during a destructive clear can permanently erase authored memory pages and audit history even though the caller receives an error rather than successful confirmation. This creates data loss on a failed command and leaves a partially initialized memory root that masks the missing prior state.
