# Memory query NaN budget selects unbounded page context

## Summary

The exported `@poe-code/memory` `selectQueryContext()` API accepts `NaN` as its token budget and then treats every page as fitting within that invalid bound. A caller attempting to constrain memory context with a malformed computed budget therefore receives all ranked page bodies in the generated prompt instead of an argument error or an empty bounded selection.

## Reproduction

Create the disposable probe `packages/memory/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const volume = new Volume();
vi.mock("node:fs/promises", () => createFsFromVolume(volume).promises);

const { selectQueryContext } = await import("./query.js");

describe("memory query NaN budget", () => {
  beforeEach(() => volume.reset());

  it("selects pages despite an invalid budget that cannot bound tokens", async () => {
    volume.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n- [a](pages/a.md)\n- [b](pages/b.md)\n",
      "/repo/.poe-code/memory/pages/a.md": "---\ndescription: A\n---\n# A\n\nsecret alpha\n",
      "/repo/.poe-code/memory/pages/b.md": "---\ndescription: B\n---\n# B\n\nsecret beta\n"
    });

    const context = await selectQueryContext(
      "/repo/.poe-code/memory",
      "secret",
      Number.NaN
    );

    expect(context.selectedPages.map((page) => page.relPath)).toEqual([
      "pages/a.md",
      "pages/b.md"
    ]);
    expect(context.tokensUsed).toBeGreaterThan(0);
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
✓ packages/memory/src/__probe__.test.ts > memory query NaN budget > selects pages despite an invalid budget that cannot bound tokens
```

Both memory pages are selected and their tokens are counted despite the supplied `budget` being `NaN`. Every guard in the selection loop compares a token count with `NaN`, and JavaScript evaluates both `indexTokens > NaN` and `tokensUsed + pageTokens > NaN` as false.

`selectQueryContext()` accepts `budget: number` without validating it at `packages/memory/src/query.ts:48` through `packages/memory/src/query.ts:52`, checks the invalid value only through numeric comparisons at `packages/memory/src/query.ts:58` through `packages/memory/src/query.ts:76`, and returns the selected pages embedded in its prompt at `packages/memory/src/query.ts:79` through `packages/memory/src/query.ts:84`. `queryMemory()` passes the caller's budget into this function before spawning the answering agent at `packages/memory/src/query.ts:18` through `packages/memory/src/query.ts:45`, and both functions are publicly exported at `packages/memory/src/index.ts:49`.

## Expected Behavior

Memory query budgeting should reject a non-finite or otherwise invalid token budget before constructing context. `NaN` must not disable the token-bound checks and select page content as if no budget existed.

## Impact

Consumers computing a budget from malformed configuration, arithmetic, or model settings can unknowingly send substantially more memory-page content to the spawned agent than intended. This undermines context-size and disclosure limits while returning a successful result whose recorded `budget` is unusable for auditing or enforcement.
