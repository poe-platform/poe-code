# Memory Reconcile Failed Index Write Corrupts Prior Generated Index

## Summary

The exported `@poe-code/memory` `reconcile()` operation regenerates `INDEX.md` by directly overwriting the active index document. If the replacement partially changes that document before rejecting, reconciliation fails while destroying the previously valid memory listing.

## Reproduction

Create a disposable Vitest probe at `packages/memory/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

const indexPath = "/repo/.poe-code/memory/INDEX.md";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    async writeFile(filePath: Parameters<typeof fs.promises.writeFile>[0], data: Parameters<typeof fs.promises.writeFile>[1], options?: Parameters<typeof fs.promises.writeFile>[2]) {
      if (filePath === indexPath) {
        await fs.promises.writeFile(filePath, "# Memory", options);
        throw new Error("index disk full");
      }
      await fs.promises.writeFile(filePath, data, options);
    }
  };
});

const { reconcile, snapshot } = await import("./reconcile.js");

describe("memory interrupted generated-index replacement", () => {
  it("destroys the prior index when reconciliation persistence rejects", async () => {
    const root = "/repo/.poe-code/memory";
    vol.reset();
    vol.fromJSON({
      [indexPath]: "# Memory index\n\n- [old](pages/old.md) — Existing entry\n",
      [`${root}/LOG.md`]: "",
      [`${root}/pages/architecture.md`]: "# Old memory\n"
    });
    const before = await snapshot(root);
    await vol.promises.writeFile(`${root}/pages/architecture.md`, "# New memory\n", "utf8");

    await expect(reconcile(root, before, "update", "probe")).rejects.toThrow("index disk full");
    const raw = vol.readFileSync(indexPath, "utf8") as string;
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("# Memory");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"# Memory"}
✓ packages/memory/src/__probe__.test.ts > memory interrupted generated-index replacement > destroys the prior index when reconciliation persistence rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`reconcile()` rebuilds index output after processing changed pages and invokes `writeIndex()` at `packages/memory/src/reconcile.ts:31` through `packages/memory/src/reconcile.ts:75`. `writeIndex()` directly overwrites the active `INDEX.md` file through `fs.writeFile()` at `packages/memory/src/reconcile.ts:137` through `packages/memory/src/reconcile.ts:145`. In the probe, an existing valid index includes a prior listed page; the reconciliation rejects with `"index disk full"` after replacing that index with incomplete text `"# Memory"`.

## Expected Behavior

Regenerating the derived memory index should leave the last valid listing intact if the new index cannot be written completely. Index replacement should be atomic or restore the previous readable index after failed persistence.

## Impact

A transient storage failure while reconciling memory can erase the generated navigation document used to enumerate or inspect saved memory pages. Even if underlying page files survive, users and downstream tools receive a corrupted index instead of the prior usable listing, making memory discovery incomplete or unreliable.
