# Generate media download transport failure bypasses user-facing error classification

## Summary

The media download helper used by `poe-code generate image`, `generate video`, and `generate audio` converts HTTP status failures and file-write failures into `MediaDownloadError`, but allows fetch transport rejections to escape unchanged. The CLI's dedicated user-facing download error handling therefore does not run for ordinary network failures while retrieving generated media.

## Reproduction

From the repository root, add this disposable Vitest probe at `src/services/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { downloadToFile, MediaDownloadError } from "./media-download.js";
import type { FileSystem } from "../utils/file-system.js";

describe("media download transport rejection", () => {
  it("lets fetch rejection escape without MediaDownloadError context", async () => {
    const fs = { writeFile: async () => {} } as unknown as FileSystem;
    const error = await downloadToFile({
      url: "https://cdn.example.test/generated.png",
      outputPath: "/output/image.png",
      fs,
      fetcher: async () => { throw new TypeError("network unreachable"); },
    }).catch((reason: unknown) => reason);
    console.log(JSON.stringify({
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      classified: error instanceof MediaDownloadError,
    }));

    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(MediaDownloadError);
  });
});
```

Run:

```sh
npm exec -- vitest run src/services/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"name":"TypeError","message":"network unreachable","classified":false}
✓ src/services/__probe__.test.ts > media download transport rejection > lets fetch rejection escape without MediaDownloadError context
```

## Observed Behavior

`downloadToFile()` obtains its response by awaiting `fetcher(options.url)` directly at `src/services/media-download.ts:17`; only a non-OK response is wrapped as a `MediaDownloadError` with `kind: "fetch"`, while only the final filesystem write is guarded by its own `try`/`catch`. A transport rejection therefore leaves the helper as a raw `TypeError`. The media generation commands catch only `MediaDownloadError` at `src/cli/commands/generate.ts:171`, so a network interruption bypasses the intended message explaining that the generated URL could not be downloaded.

## Expected Behavior

All failures fetching generated media, including network transport rejection and response-body read failure, should be reported consistently through `MediaDownloadError` so the CLI can render its documented user-facing download failure guidance.

## Impact

An expired CDN connection, DNS failure, offline network, or interrupted media response surfaces as a low-level runtime exception rather than the CLI's actionable generated-file error. Users cannot distinguish a recoverable media-download failure from an internal crash, and automation depending on classified errors receives inconsistent behavior for equivalent download failures.
