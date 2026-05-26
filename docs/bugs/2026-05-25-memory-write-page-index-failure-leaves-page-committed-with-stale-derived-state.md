# Memory write page index failure leaves page committed with stale derived state

## Summary

The exported `@poe-code/memory` `writePage()` API writes the requested page before reconciling its generated `INDEX.md` and `LOG.md` state. If index persistence fails during reconciliation, `writePage()` rejects but leaves the new page content committed while both derived artifacts still describe the previous state.

## Reproduction

From the repository root, add this disposable Vitest probe at `packages/memory/src/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  const promises = fs.promises;
  return {
    ...promises,
    async writeFile(filePath: string | Buffer | URL | number, data: unknown, options?: unknown) {
      if (String(filePath).endsWith("/INDEX.md")) {
        throw new Error("index offline");
      }
      return promises.writeFile(filePath as never, data as never, options as never);
    },
  };
});

const { writePage } = await import("./write.js");

describe("memory write reconciliation failure", () => {
  beforeEach(() => {
    vol.reset();
    vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));
  });

  it("leaves the updated page committed when INDEX.md update rejects", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# old index\n",
      [`${root}/LOG.md`]: "",
      [`${root}/pages/note.md`]: "# old body\n",
    });

    await expect(writePage(root, "pages/note.md", "# new body\n", { reason: "probe" })).rejects.toThrow("index offline");

    const output = {
      page: await vol.promises.readFile(`${root}/pages/note.md`, "utf8"),
      index: await vol.promises.readFile(`${root}/INDEX.md`, "utf8"),
      log: await vol.promises.readFile(`${root}/LOG.md`, "utf8"),
    };
    console.log(JSON.stringify(output));

    expect(output.page).toContain("# new body");
    expect(output.index).toBe("# old index\n");
    expect(output.log).toBe("");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"page":"# new body\n","index":"# old index\n","log":""}
✓ packages/memory/src/__probe__.test.ts > memory write reconciliation failure > leaves the updated page committed when INDEX.md update rejects
```

## Observed Behavior

`writePage()` snapshots existing memory state and immediately overwrites the target page at `packages/memory/src/write.ts:10`, then awaits `reconcile()`. Reconciliation may rewrite changed page frontmatter before computing a diff, then writes the generated index and only afterward appends the change log at `packages/memory/src/reconcile.ts:35`, `packages/memory/src/reconcile.ts:98`, and `packages/memory/src/reconcile.ts:137`. In the probe, only the `INDEX.md` write rejects: the caller receives an error, but `pages/note.md` already contains `# new body`, while `INDEX.md` and `LOG.md` remain unchanged.

## Expected Behavior

A failing `writePage()` operation should not leave memory in a partially committed state. Either the page plus its generated index/log updates should be committed together, or any failure during reconciliation should roll back the page write before rejecting.

## Impact

Filesystem interruptions or permission failures affecting derived memory artifacts can make a failed authoring call silently change the source pages without recording or indexing that change. Subsequent searches, listings, audit review, and retry behavior can disagree with the actual stored page content, making memory state unreliable and hard to repair safely.
