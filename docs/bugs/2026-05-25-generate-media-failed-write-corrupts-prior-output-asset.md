# Generate Media Failed Write Corrupts Prior Output Asset

## Summary

The media generation download path persists fetched bytes by directly overwriting the selected output file. If writing the downloaded payload partially modifies an existing asset before rejecting, the command reports `MediaDownloadError` while destroying the previous valid output.

## Reproduction

Create a disposable Vitest probe at `src/services/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { downloadToFile } from "./media-download.js";
import type { FileSystem } from "../utils/file-system.js";

describe("media download interrupted output replacement", () => {
  it("destroys an existing asset when download persistence rejects", async () => {
    const outputPath = "/repo/generated/image.png";
    const base = createFsFromVolume(Volume.fromJSON({ [outputPath]: Buffer.from("old-image") })).promises;
    const fs = {
      ...base,
      async writeFile(filePath: string, data: string | Uint8Array, options?: unknown) {
        if (filePath === outputPath) {
          await base.writeFile(filePath, Buffer.from("new"), options as never);
          throw new Error("media disk full");
        }
        await base.writeFile(filePath, data, options as never);
      }
    } as unknown as FileSystem;

    await expect(downloadToFile({
      url: "https://example.test/image.png",
      outputPath,
      fs,
      fetcher: async () => new Response(Buffer.from("new-image"), { status: 200 })
    })).rejects.toMatchObject({ name: "MediaDownloadError", kind: "write" });
    const raw = await base.readFile(outputPath, "utf8");
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("new");
  });
});
```

Run:

```sh
npm exec -- vitest run src/services/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"new"}
✓ src/services/__probe__.test.ts > media download interrupted output replacement > destroys an existing asset when download persistence rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`downloadToFile()` fetches the full media payload and directly writes it to the caller-selected output path through `options.fs.writeFile()` at `src/services/media-download.ts:17` through `src/services/media-download.ts:51`. The media-generation command delegates saved file downloads to this helper at `src/cli/commands/generate.ts:187` through `src/cli/commands/generate.ts:196`. In the probe, the destination initially contains `old-image`; the helper rejects with a write-kind `MediaDownloadError` after the live output has already been replaced by partial bytes `new`.

## Expected Behavior

Saving a generated media result should preserve an existing output asset if the new download cannot be committed completely. Download persistence should use atomic replacement or equivalent rollback behavior before replacing a user-selected existing file.

## Impact

A transient disk or filesystem failure during media generation can destroy a previously generated or user-provided output image while the command reports failure. Retrying may not recover the overwritten original, making failed generation destructive to user assets.
