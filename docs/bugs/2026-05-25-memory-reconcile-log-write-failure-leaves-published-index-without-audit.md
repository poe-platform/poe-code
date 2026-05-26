# Memory Reconcile Log Write Failure Leaves Published Index Without Audit

## Summary

The exported `@poe-code/memory` `reconcile()` operation publishes an updated generated `INDEX.md` before it appends the matching entry to `LOG.md`. If the log write fails cleanly, reconciliation rejects after the index has already changed, leaving derived memory state published without its audit record.

## Reproduction

Create a disposable probe at `packages/memory/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { reconcile, snapshot } = await import("./reconcile.js");

describe("memory reconcile log publication failure probe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vol.reset();
  });

  it("leaves page and index updates committed when log append rejects", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n\n- [page](pages/page.md) — Before\n",
      [`${root}/LOG.md`]: "",
      [`${root}/pages/page.md`]: [
        "---", "description: Before", "---", "# Page", "", "old", ""
      ].join("\n")
    });
    const before = await snapshot(root);
    await vol.promises.writeFile(
      `${root}/pages/page.md`,
      ["---", "description: After", "---", "# Page", "", "new", ""].join("\n"),
      "utf8"
    );
    vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));
    const originalWriteFile = vol.promises.writeFile.bind(vol.promises);
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (
        String(filePath) === `${root}/LOG.md` &&
        !(typeof options === "object" && options !== null && "flag" in options && options.flag === "wx")
      ) {
        throw new Error("injected log publication failure");
      }
      return originalWriteFile(filePath, data, options);
    });

    await expect(reconcile(root, before, "edit", "updated page")).rejects.toThrow(
      "injected log publication failure"
    );
    await expect(vol.promises.readFile(`${root}/INDEX.md`, "utf8")).resolves.toContain(
      "[page](pages/page.md) — After"
    );
    await expect(vol.promises.readFile(`${root}/LOG.md`, "utf8")).resolves.toBe("");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
```

The probe passes, proving that index publication precedes the rejected log publication. Remove the disposable probe afterward.

## Observed Behavior

`reconcile()` rejects with `injected log publication failure`, but `INDEX.md` already changes from the `Before` description to `After`. `LOG.md` remains empty, so there is no corresponding audit record for the index-visible memory change that has already been published.

## Expected Behavior

The generated index update and its matching audit-log append should be committed as one coherent reconciliation outcome. If log publication fails, reconciliation should not leave newly published index state without its audit record, or it should roll back earlier derived-state writes before rejecting.

## Impact

Memory browsing and audit history can disagree after a failed reconciliation: users and agents see updated indexed content while provenance logs omit the change entirely. This weakens accountability, makes failed operations non-retryable without investigation, and prevents consumers from trusting the log as a record of visible memory-state transitions.
