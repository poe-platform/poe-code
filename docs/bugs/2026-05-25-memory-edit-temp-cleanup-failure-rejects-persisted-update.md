# Memory edit temporary cleanup failure rejects a persisted update

## Summary

The exported `@poe-code/memory` `editPage()` API persists changed editor content through `writePage()` before deleting its temporary editor directory in a `finally` block. If that final temporary-directory removal fails, `editPage()` rejects even though the page update and its audit log entry have already been written successfully.

## Reproduction

1. Add this disposable probe as `packages/memory/src/__probe__.test.ts`:

```ts
import * as fs from "node:fs/promises";
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => {
  const { fs: memoryFs } = await import("memfs");
  return memoryFs.promises;
});

const { editPage } = await import("./edit.js");

describe("memory edit cleanup failure probe", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it("rejects after persisting the edit when temporary directory removal fails", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: "",
      [`${root}/pages/note.md`]: "---\nname: note\n---\nOriginal\n"
    });
    vi.spyOn(fs, "rm").mockRejectedValue(new Error("temp cleanup denied"));

    await expect(
      editPage(root, "pages/note.md", {
        reason: "update note",
        launchEditor: async (filePath) => {
          await fs.writeFile(filePath, "---\nname: note\n---\nUpdated\n", "utf8");
        }
      })
    ).rejects.toThrow("temp cleanup denied");

    await expect(fs.readFile(`${root}/pages/note.md`, "utf8")).resolves.toContain("Updated");
    await expect(fs.readFile(`${root}/LOG.md`, "utf8")).resolves.toContain("update note");
  });
});
```

2. Run the focused probe:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
```

3. Remove the disposable probe after validation.

The probe passes on the current implementation:

```text
✓ packages/memory/src/__probe__.test.ts > memory edit cleanup failure probe > rejects after persisting the edit when temporary directory removal fails
```

## Observed Behavior

The editor changes `pages/note.md`, `writePage()` successfully persists the updated page and records `update note` in `LOG.md`, and only then does the mocked `fs.rm(tempDir)` fail. Because the cleanup occurs in `finally` without preserving the successful result, `editPage()` rejects with `temp cleanup denied` while durable memory state indicates that the edit succeeded.

## Expected Behavior

Failure to remove a disposable editor staging directory should not convert an already persisted memory edit into an operation failure. Cleanup should be best-effort or surfaced separately from the successful `EditPageResult`, while preserving any warning needed to diagnose stale temporary artifacts.

## Impact

Filesystem permissions, antivirus interference, or transient cleanup errors can cause callers to report or retry an edit that was already committed and logged. Retried edits may duplicate human changes or audit entries, while automation receives a failure result that contradicts the durable memory state.
