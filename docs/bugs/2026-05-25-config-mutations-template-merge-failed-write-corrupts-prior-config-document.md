# Config mutations template merge failed write corrupts prior config document

## Summary

The exported `@poe-code/config-mutations` template configuration merge operations serialize merged JSON or TOML state and write it directly over the live target. If a template merge write partially overwrites a valid existing configuration before rejecting, the public mutation call fails after corrupting the prior persisted document.

## Reproduction

Add this disposable in-memory Vitest probe as `packages/config-mutations/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runMutations } from "./execution/run-mutations.js";
import { templateMutation } from "./mutations/template-mutation.js";
import type { FileSystem } from "./types.js";

describe("templateMutation.mergeJson interrupted update", () => {
  it("rejects after corrupting a prior valid JSON document", async () => {
    const homeDir = "/home/test";
    const targetPath = `${homeDir}/settings.json`;
    const volume = Volume.fromJSON({ [targetPath]: '{"keep":true}\n' });
    const base = createFsFromVolume(volume).promises as unknown as FileSystem;
    const fs: FileSystem = {
      ...base,
      async writeFile(filePath, data, options) {
        if (filePath === targetPath) {
          await base.writeFile(filePath, '{"keep":', options);
          throw new Error("template merge write interrupted");
        }
        await base.writeFile(filePath, data, options);
      }
    };

    await expect(
      runMutations(
        [templateMutation.mergeJson({ target: "~/settings.json", templateId: "patch" })],
        { fs, homeDir, templates: async () => '{"added":true}' }
      )
    ).rejects.toThrow("template merge write interrupted");

    const retained = await base.readFile(targetPath, "utf8");
    console.log(JSON.stringify({ retained }));
    expect(retained).toBe('{"keep":');
  });
});
```

Run the focused probe, then delete the disposable file:

```sh
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm -f packages/config-mutations/src/__probe__.test.ts
```

## Observed Behavior

The probe passes and leaves malformed JSON at the existing configuration path after the template merge rejects:

```text
{"retained":"{\"keep\":"}
✓ packages/config-mutations/src/__probe__.test.ts > templateMutation.mergeJson interrupted update > rejects after corrupting a prior valid JSON document
```

`templateMutation.mergeJson()` and `templateMutation.mergeToml()` are public mutation constructors in `packages/config-mutations/src/mutations/template-mutation.ts:52` through `packages/config-mutations/src/mutations/template-mutation.ts:75`, exported through `packages/config-mutations/src/index.ts:1` through `packages/config-mutations/src/index.ts:6`. Both execute through `applyTemplateMerge()`, which reads and parses existing content, merges rendered template state, serializes it, and directly calls `context.fs.writeFile(targetPath, serialized, ...)` at `packages/config-mutations/src/execution/apply-mutation.ts:656` through `packages/config-mutations/src/execution/apply-mutation.ts:727`. A failed replacement has no atomic commit or rollback protection.

## Expected Behavior

Template merges should preserve the most recent valid target document when replacement persistence fails. Both JSON and TOML merge mutations should use staged atomic replacement or restore the original document before rejecting an interrupted update.

## Impact

Consumers that render and merge template configuration, including setup and agent-install flows, can corrupt previously working JSON or TOML configuration on a single filesystem failure. The failed mutation leaves unrelated preserved keys unreadable and requires manual recovery even though the requested merge did not successfully complete.
