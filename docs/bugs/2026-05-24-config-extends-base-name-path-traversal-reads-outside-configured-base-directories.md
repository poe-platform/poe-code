# Config extends base-name path traversal reads outside configured base directories

## Summary

The exported `findBase()` helper in `@poe-code/config-extends` accepts a base `name` string and appends supported file extensions beneath configured base directories, but it does not reject traversal segments. A name such as `../secret` therefore resolves and reads a document outside the permitted base directory list.

## Reproduction

From the repository root, run a disposable Vitest probe with an in-memory filesystem containing a document adjacent to, but not inside, the configured base directory:

```sh
cat > /tmp/config-extends-base-name-traversal-probe.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { findBase } from "./discover.js";
import type { FileSystem } from "./types.js";

describe("config-extends base traversal", () => {
  it("loads a config outside the configured bases directory through the base name", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({
      "/project/secret.md": "external base content",
    })).promises as unknown as FileSystem;
    const result = await findBase("../secret", ["/project/bases"], fs);
    console.log(JSON.stringify(result));
    expect(result).toEqual({ content: "external base content", filePath: "/project/secret.md" });
  });
});
PROBE
cp /tmp/config-extends-base-name-traversal-probe.test.ts packages/config-extends/src/__probe__.test.ts
trap 'rm -f packages/config-extends/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/config-extends/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Although `/project/bases` is the only configured base directory, the lookup reads `/project/secret.md` by resolving the traversal-bearing base name:

```text
{"content":"external base content","filePath":"/project/secret.md"}
✓ packages/config-extends/src/__probe__.test.ts > config-extends base traversal > loads a config outside the configured bases directory through the base name
```

`packages/config-extends/src/discover.ts:9` through `packages/config-extends/src/discover.ts:25` construct candidate paths with `path.join(basePath, `${name}${extension}`)` and read the resulting normalized path without validating that it remains contained beneath `basePath`.

## Expected Behavior

Base discovery should restrict requested base names to files contained within each configured base directory. Names containing traversal segments or absolute-path escapes should be rejected rather than resolved outside the configured search roots.

## Impact

SDK callers or higher-level features that accept an insufficiently trusted base name can read arbitrary supported-format files adjacent to or above their configured base directories and treat that external content as inherited configuration or prompt data.
