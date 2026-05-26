# Config extends malformed extends value is dropped and disables auto inheritance

## Summary

The exported `@poe-code/config-extends` resolver treats any present `extends` field as a reserved control key, but recognizes inheritance only when its value is exactly boolean `true`. With `autoExtend: true`, a document containing a malformed value such as `extends: "typo"` neither inherits from its matching base nor preserves the unexpected configuration value for callers to diagnose; the field silently disappears from resolved data.

## Reproduction

From the repository root, create and execute this disposable in-memory Vitest probe, then remove it:

```sh
cat > packages/config-extends/src/__probe__.test.ts <<'EOF'
import { Volume, createFsFromVolume } from "memfs";
import { expect, it } from "vitest";
import { resolve } from "./resolve.js";
import type { FileSystem } from "./types.js";

it("silently drops a malformed extends value while blocking autoExtend", async () => {
  const volume = Volume.fromJSON({
    "/bases/review.yaml": "prompt: Base prompt"
  });
  const fs = createFsFromVolume(volume).promises as unknown as FileSystem;

  const result = await resolve([
    {
      source: "document",
      filePath: "/workspace/review.yaml",
      content: 'extends: "typo"\ntitle: Document'
    },
    {
      source: "base",
      path: "/bases"
    }
  ], { fs, autoExtend: true });

  expect(result).toEqual({
    data: { title: "Document" },
    sources: { title: "document" },
    chain: ["/workspace/review.yaml"]
  });
});
EOF
npm exec -- vitest run packages/config-extends/src/__probe__.test.ts --reporter verbose
rm -f packages/config-extends/src/__probe__.test.ts
```

The focused probe passes:

```text
✓ packages/config-extends/src/__probe__.test.ts > silently drops a malformed extends value while blocking autoExtend
```

## Observed Behavior

Although `/bases/review.yaml` exists and `autoExtend: true` is enabled, resolving the document returns only `{ title: "Document" }` with no base in the output chain and no `extends` field explaining why inheritance did not occur. `parseDocument()` marks the field as present, sets its control value only when `data.extends === true`, and unconditionally deletes the original field at `packages/config-extends/src/parse.ts:6` through `packages/config-extends/src/parse.ts:23`. `shouldResolveBase()` then suppresses automatic base resolution whenever any explicit `extends` field existed, including an invalid non-boolean value, at `packages/config-extends/src/resolve.ts:29` through `packages/config-extends/src/resolve.ts:44` and `packages/config-extends/src/resolve.ts:319` through `packages/config-extends/src/resolve.ts:324`.

## Expected Behavior

The reserved `extends` control field should be validated as a boolean before it affects resolution. A malformed value should fail with an actionable configuration error, rather than silently disabling `autoExtend` and being removed from the resolved result.

## Impact

A typo or generated invalid value in an inheritable workflow/config document can silently prevent base prompts and defaults from being loaded while hiding the offending input from downstream diagnostics. Consumers can run with incomplete configuration and no visible indication that an invalid control field overrode their configured auto-inheritance behavior.
