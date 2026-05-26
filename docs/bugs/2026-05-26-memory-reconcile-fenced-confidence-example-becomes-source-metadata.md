# Memory reconcile fenced confidence example becomes source metadata

## Summary

The exported `@poe-code/memory` reconciliation pipeline parses confidence-tag comments inside fenced Markdown code examples as if they were real page claims. Editing a memory page to document tag syntax can therefore cause `reconcile()` to persist fictitious `sources` frontmatter derived solely from an example block.

## Reproduction

Create the disposable probe `packages/memory/src/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { reconcile, snapshot } = await import("./reconcile.js");

describe("memory reconciler fenced confidence example", () => {
  beforeEach(() => {
    vol.reset();
    vi.setSystemTime(new Date("2026-05-26T12:00:00.000Z"));
  });

  it("adds source metadata derived only from a fenced code example", async () => {
    const root = "/repo/.poe-code/memory";
    const original = "# Example\n\nBefore.\n";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: "",
      [`${root}/pages/example.md`]: original
    });
    const before = await snapshot(root);
    await vol.promises.writeFile(
      `${root}/pages/example.md`,
      [
        "# Example",
        "",
        "```md",
        "<!-- memory:extracted source=outside/secret.ts#L1 -->",
        "This is documentation syntax only.",
        "```",
        ""
      ].join("\n"),
      "utf8"
    );

    await reconcile(root, before, "update", "document syntax");
    const rewritten = await vol.promises.readFile(`${root}/pages/example.md`, "utf8");

    expect(rewritten).toContain("sources:\n  - outside/secret.ts#L1");
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
rm -f packages/memory/src/__probe__.test.ts
```

## Observed Behavior

The probe passes:

```text
✓ packages/memory/src/__probe__.test.ts > memory reconciler fenced confidence example > adds source metadata derived only from a fenced code example
```

The edited page contains no factual tagged claim outside its fenced example, but after reconciliation its YAML frontmatter contains `sources: [outside/secret.ts#L1]`.

`parseClaims()` scans normalized text line by line and recognizes any standalone tag-comment line without tracking fenced code context at `packages/memory/src/confidence.ts:7` through `packages/memory/src/confidence.ts:36`. `denormalizeSources()` applies that parser to each page body at `packages/memory/src/reconcile.ts:120` through `packages/memory/src/reconcile.ts:172`, and `reconcile()` rewrites changed pages after normalization at `packages/memory/src/reconcile.ts:31` through `packages/memory/src/reconcile.ts:76`.

## Expected Behavior

Confidence tags shown inside fenced code blocks should remain documentation or literal examples and must not contribute claim provenance. Reconciliation should derive `sources` only from active page claims outside Markdown code fences.

## Impact

Memory pages that document the confidence-tag format, quote example content, or include code-generated Markdown can acquire false provenance metadata during ordinary reconciliation. Subsequent token accounting, source auditing, explanations, and index consumers can trust or read unrelated paths as sources even though no page claim cited them.
