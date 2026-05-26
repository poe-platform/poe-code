# Tiny stdio MCP remote image and audio reject valid uppercase MIME types

## Summary

The public `Image.fromUrl()` and `Audio.fromUrl()` helpers validate response `Content-Type` values with case-sensitive set membership. Standard HTTP responses carrying valid case variants such as `Image/PNG` or `Audio/MPEG` are rejected as undetectable media whenever magic-byte detection does not recognize the payload.

## Reproduction

Create a disposable probe at `packages/tiny-stdio-mcp-server/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { Audio, Image } from "./index.js";

describe("remote media MIME case normalization", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects standard image and audio MIME types when header casing differs", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
        headers: { get: () => "Image/PNG" },
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
        headers: { get: () => "Audio/MPEG" },
      }));

    await expect(Image.fromUrl("https://example.test/pixel")).rejects.toThrow(
      "Unable to detect image MIME type"
    );
    await expect(Audio.fromUrl("https://example.test/sound")).rejects.toThrow(
      "Unable to detect audio MIME type"
    );
    console.log(JSON.stringify({ imageHeader: "Image/PNG", audioHeader: "Audio/MPEG", rejected: true }));
  });
});
```

Run it and remove the disposable probe:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
rm packages/tiny-stdio-mcp-server/src/__probe__.test.ts
```

## Observed Behavior

The probe passes because both standard media responses are rejected:

```text
{"imageHeader":"Image/PNG","audioHeader":"Audio/MPEG","rejected":true}
```

`Image.fromUrl()` and `Audio.fromUrl()` each extract the media type directly from `content-type` and require exact membership in lowercase supported-MIME sets in `packages/tiny-stdio-mcp-server/src/content/image.ts` and `packages/tiny-stdio-mcp-server/src/content/audio.ts`. Neither path normalizes media-type casing before validation.

## Expected Behavior

MIME type matching should be case-insensitive, as media type tokens are not case-sensitive. Valid header spellings such as `Image/PNG` and `Audio/MPEG` should produce the same image and audio content blocks as their lowercase equivalents.

## Impact

Tools that embed media fetched from compliant HTTP endpoints can fail solely because an upstream server capitalizes its `Content-Type` header. This breaks otherwise valid MCP rich-content responses and makes remote image/audio handling inconsistent with ordinary HTTP media-type semantics.
