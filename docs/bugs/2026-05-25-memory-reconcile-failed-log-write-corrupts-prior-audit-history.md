# Memory Reconcile Failed Log Write Corrupts Prior Audit History

## Summary

The exported `@poe-code/memory` `reconcile()` operation extends its cumulative `LOG.md` audit history by reading the current file and overwriting it with old plus new entries. If that replacement partially modifies the log before rejecting, reconciliation fails while destroying previously recorded memory-change history.

## Reproduction

Create a disposable Vitest probe at `packages/memory/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

const logPath = "/repo/.poe-code/memory/LOG.md";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    async writeFile(filePath: Parameters<typeof fs.promises.writeFile>[0], data: Parameters<typeof fs.promises.writeFile>[1], options?: Parameters<typeof fs.promises.writeFile>[2]) {
      if (filePath === logPath) {
        await fs.promises.writeFile(filePath, "- truncated", options);
        throw new Error("log disk full");
      }
      await fs.promises.writeFile(filePath, data, options);
    }
  };
});

const { reconcile, snapshot } = await import("./reconcile.js");

describe("memory interrupted reconciliation log update", () => {
  it("destroys prior audit history when appending a change log rejects", async () => {
    const root = "/repo/.poe-code/memory";
    vol.reset();
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [logPath]: "- 2026-05-24T00:00:00.000Z  **update** `pages/old.md` — kept\n",
      [`${root}/pages/architecture.md`]: "# Old memory\n"
    });
    const before = await snapshot(root);
    await vol.promises.writeFile(`${root}/pages/architecture.md`, "# New memory\n", "utf8");

    await expect(reconcile(root, before, "update", "probe")).rejects.toThrow("log disk full");
    const raw = vol.readFileSync(logPath, "utf8") as string;
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("- truncated");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"- truncated"}
✓ packages/memory/src/__probe__.test.ts > memory interrupted reconciliation log update > destroys prior audit history when appending a change log rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`reconcile()` computes its page diff, writes generated index state, and then calls `appendLogEntries()` at `packages/memory/src/reconcile.ts:31` through `packages/memory/src/reconcile.ts:76`. `appendLogEntries()` reads the complete existing `LOG.md` history and directly replaces it with the old text plus new lines through `fs.writeFile()` at `packages/memory/src/reconcile.ts:98` through `packages/memory/src/reconcile.ts:117`. In the probe, the log already contains a valid prior audit entry; the new reconciliation rejects with `"log disk full"` after `LOG.md` is truncated to `"- truncated"`.

## Expected Behavior

Adding new reconciliation history should preserve existing audit entries if the log update cannot be committed completely. Cumulative audit log replacements should be atomic or leave the prior readable log intact after failed persistence.

## Impact

A transient write failure during memory reconciliation can erase the audit trail for earlier memory modifications, not merely omit the new entry. Users and agents then lose provenance for prior edits, making later inspection, debugging, and trust decisions about memory state incomplete or misleading.
