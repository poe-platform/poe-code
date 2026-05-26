# Config extends rejects valid base directory with trailing separator

## Summary

`@poe-code/config-extends` can discover an inherited document beneath a configured base directory and then reject that same document as outside the configured path when the base path ends with a directory separator. A normal base configuration such as `/bases/` therefore breaks required `extends: true` resolution even though the matching file is directly inside that directory.

## Reproduction

From the repository root, run this isolated passing probe using a valid base directory path with a trailing slash:

```sh
cat > /tmp/config-extends-trailing-separator-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolve } from "./resolve.js";
import type { FileSystem } from "./types.js";

function createMemFs(files: Record<string, string>): FileSystem {
  const volume = Volume.fromJSON(files);
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

describe("config-extends trailing base separator", () => {
  it("rejects a base found beneath a configured directory ending with a slash", async () => {
    const fs = createMemFs({ "/bases/review.yaml": "tone: base" });
    const outcome = await resolve([
      { source: "base", path: "/bases/" },
      { source: "document", filePath: "/project/review.yaml", content: "extends: true\ntitle: Document" }
    ], { fs }).then(
      (value) => ({ resolved: value.data }),
      (error: unknown) => ({ rejected: error instanceof Error ? error.message : String(error) })
    );
    console.log(JSON.stringify({ outcome }));
    expect(outcome).toEqual({ rejected: "Resolved base is outside configured base paths: /bases/review.yaml" });
  });
});
EOF
cp /tmp/config-extends-trailing-separator-probe.test.ts packages/config-extends/src/__probe__.test.ts
trap 'rm -f packages/config-extends/src/__probe__.test.ts /tmp/config-extends-trailing-separator-probe.test.ts' EXIT
./node_modules/.bin/vitest run packages/config-extends/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Resolution rejects a base document that `findBase()` has just found inside `/bases/`:

```text
{"outcome":{"rejected":"Resolved base is outside configured base paths: /bases/review.yaml"}}
✓ packages/config-extends/src/__probe__.test.ts > config-extends trailing base separator > rejects a base found beneath a configured directory ending with a slash
```

`packages/config-extends/src/discover.ts:13` joins `/bases/` with `review.yaml`, producing the valid normalized file path `/bases/review.yaml`. `packages/config-extends/src/resolve.ts:149` then compares `path.dirname(discoveredBase.filePath)`, which is `/bases`, against the original unnormalized layer path `/bases/` with strict equality. The equivalent paths do not match as strings, so required inheritance throws the outside-path error.

## Expected Behavior

A configured base directory should resolve identically with or without a trailing platform directory separator. A base discovered directly beneath `/bases/` should be merged into the extending document rather than rejected as outside the configured directory.

## Impact

Callers that supply conventional directory strings ending with `/` cannot use inherited configuration from those directories. Both required inheritance and auto-extension fail unexpectedly after discovering an otherwise valid matching base file.
