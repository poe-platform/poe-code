# Memory Append Page Failed Write Corrupts Prior Authored Content

## Summary

The exported `@poe-code/memory` `appendToPage()` API updates an existing memory page by directly overwriting its active Markdown file. If persistence partially modifies that file before rejecting, an append failure destroys the previously valid authored content before reconciliation begins.

## Reproduction

Create a disposable Vitest probe at `packages/memory/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

const pagePath = "/repo/.poe-code/memory/pages/architecture.md";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    async writeFile(filePath: Parameters<typeof fs.promises.writeFile>[0], data: Parameters<typeof fs.promises.writeFile>[1], options?: Parameters<typeof fs.promises.writeFile>[2]) {
      if (filePath === pagePath) {
        await fs.promises.writeFile(filePath, "---\nname:", options);
        throw new Error("page disk full");
      }
      await fs.promises.writeFile(filePath, data, options);
    }
  };
});

vi.mock("./lock.js", () => ({ withLock: async (_root: string, work: () => Promise<unknown>) => await work() }));

const { appendToPage } = await import("./write.js");

describe("memory interrupted page append", () => {
  it("destroys prior authored content when page persistence rejects", async () => {
    vol.reset();
    vol.fromJSON({
      [pagePath]: "---\nname: architecture\n---\n# Existing memory\n",
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/LOG.md": ""
    });

    await expect(appendToPage("/repo/.poe-code/memory", "pages/architecture.md", "\nNew detail.\n", {
      reason: "probe"
    })).rejects.toThrow("page disk full");
    const raw = vol.readFileSync(pagePath, "utf8") as string;
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("---\nname:");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"---\nname:"}
✓ packages/memory/src/__probe__.test.ts > memory interrupted page append > destroys prior authored content when page persistence rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`appendToPage()` reads the current Markdown page, builds replacement content with the appended body, and directly overwrites the same page through `fs.writeFile()` at `packages/memory/src/write.ts:30` through `packages/memory/src/write.ts:53`. In the probe, the original page contains valid frontmatter and `# Existing memory`; the append rejects with `"page disk full"` after the active page has already been truncated to invalid content `"---\nname:"`. This occurs before its later `reconcile()` update of generated index or log state.

## Expected Behavior

Appending memory content should preserve the last valid page document when the new version cannot be committed completely. The page write should use atomic replacement or rollback semantics before attempting derived reconciliation changes.

## Impact

A transient filesystem failure during routine memory authoring can erase previously recorded project knowledge and leave malformed Markdown/frontmatter at the canonical page path. The failed append call signals no successful update, but subsequent search, display, reconciliation, or agent memory use sees corrupted content rather than the prior valid page.
