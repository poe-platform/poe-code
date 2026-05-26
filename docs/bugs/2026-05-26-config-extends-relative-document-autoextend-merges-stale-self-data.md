# Config extends relative document autoExtend merges stale self data

## Summary

The exported `@poe-code/config-extends` `resolve()` API fails to recognize a document as its own optional auto-inheritance base when the supplied document `filePath` is relative but base discovery returns an absolute path. As a result, resolving edited in-memory document contents can silently merge obsolete fields from the on-disk copy of the same document and report the same file twice in its inheritance chain.

## Reproduction

Create the following disposable Vitest probe at `packages/config-extends/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";

import { resolve } from "./resolve.js";
import type { FileSystem } from "./types.js";

describe("config-extends relative document self inheritance", () => {
  it("merges stale on-disk data from the same relative document as an auto base", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({
      "/repo/review.yaml": "title: Saved\nobsolete: keep-me"
    })).promises as unknown as FileSystem;

    const relativeResult = await resolve(
      [
        { source: "document", filePath: "review.yaml", content: "title: Edited" },
        { source: "project-base", path: "/repo" }
      ],
      { fs, autoExtend: true }
    );
    const absoluteResult = await resolve(
      [
        { source: "document", filePath: "/repo/review.yaml", content: "title: Edited" },
        { source: "project-base", path: "/repo" }
      ],
      { fs, autoExtend: true }
    );

    expect(relativeResult.data).toEqual({ title: "Edited", obsolete: "keep-me" });
    expect(relativeResult.chain).toEqual(["review.yaml", "/repo/review.yaml"]);
    expect(absoluteResult.data).toEqual({ title: "Edited" });
    expect(absoluteResult.chain).toEqual(["/repo/review.yaml"]);
  });
});
```

Run it and remove the disposable probe:

```sh
npm exec -- vitest run packages/config-extends/src/__probe__.test.ts --reporter verbose
rm -f packages/config-extends/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/config-extends/src/__probe__.test.ts > config-extends relative document self inheritance > merges stale on-disk data from the same relative document as an auto base
```

## Observed Behavior

With document content `title: Edited` and a stale on-disk copy at `/repo/review.yaml` containing `obsolete: keep-me`, resolving the relative document path `review.yaml` with `autoExtend: true` returns `{ title: "Edited", obsolete: "keep-me" }` and chain `["review.yaml", "/repo/review.yaml"]`. Passing the equivalent absolute document path instead returns only `{ title: "Edited" }`, proving the extra value is loaded by treating the same file as a base. `resolve()` seeds its cycle/self-detection set with the raw `documentLayer.filePath` at `packages/config-extends/src/resolve.ts:35` through `packages/config-extends/src/resolve.ts:43`, while `findBase()` returns the path built beneath the absolute base directory at `packages/config-extends/src/discover.ts:12` through `packages/config-extends/src/discover.ts:24`. The comparison at `packages/config-extends/src/resolve.ts:138` does not normalize equivalent paths before deciding that optional auto-inheritance found a separate base.

## Expected Behavior

Optional `autoExtend` resolution should treat path-equivalent references to the input document as the same file, regardless of whether callers supply a relative or absolute document `filePath`. Resolving unsaved or transformed in-memory document contents should not reload and merge stale persisted fields from that document as inherited base configuration.

## Impact

Editors, generators, agents, or CLIs that pass relative document identities while resolving updated in-memory content can unknowingly resurrect deleted configuration keys, prompts, provider selections, or execution settings from disk. The returned inheritance chain also falsely implies that a separate base contributed values, making provenance and review misleading exactly when callers are validating a proposed document update before writing it.
