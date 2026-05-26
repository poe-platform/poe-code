# Tiny stdio MCP base64 content constructors accept malformed payloads

## Summary

The public `tiny-stdio-mcp-server` rich-content constructors accept malformed base64 payloads without validation. `Image.fromBase64()` and `Audio.fromBase64()` expose invalid base64 strings directly in successful MCP content blocks, while `File.fromBase64()` silently decodes malformed input into different bytes and returns a successful embedded resource.

## Reproduction

Create a disposable probe at `packages/tiny-stdio-mcp-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Audio, File, Image } from "./index.js";

describe("tiny-stdio malformed base64 content constructors", () => {
  it("publishes malformed base64 and silently decodes malformed files", () => {
    expect(Image.fromBase64("not base64!", "image/png").toContentBlock()).toEqual({
      type: "image",
      data: "not base64!",
      mimeType: "image/png"
    });
    expect(Audio.fromBase64("not base64!", "audio/mpeg").toContentBlock()).toEqual({
      type: "audio",
      data: "not base64!",
      mimeType: "audio/mpeg"
    });
    expect(File.fromBase64("%%%", "application/octet-stream").toContentBlock()).toEqual({
      type: "resource",
      resource: {
        uri: "file:///data",
        mimeType: "application/octet-stream",
        blob: ""
      }
    });
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny-stdio malformed base64 content constructors > publishes malformed base64 and silently decodes malformed files
```

## Observed Behavior

`Image.fromBase64()` stores the caller's supplied string without validating or decoding it at `packages/tiny-stdio-mcp-server/src/content/image.ts:66` through `packages/tiny-stdio-mcp-server/src/content/image.ts:75`, and `Audio.fromBase64()` does the same at `packages/tiny-stdio-mcp-server/src/content/audio.ts:78` through `packages/tiny-stdio-mcp-server/src/content/audio.ts:87`. Both helpers therefore return successful image or audio blocks whose `data` field is the invalid string `"not base64!"`. `File.fromBase64()` passes its input to `Buffer.from(base64, "base64")` at `packages/tiny-stdio-mcp-server/src/content/file.ts:76` through `packages/tiny-stdio-mcp-server/src/content/file.ts:80` without requiring a canonical valid payload; Node silently accepts `"%%%"` as empty bytes, and `toContentBlock()` returns a successful resource with `blob: ""` at `packages/tiny-stdio-mcp-server/src/content/file.ts:101` through `packages/tiny-stdio-mcp-server/src/content/file.ts:117`.

## Expected Behavior

Constructors that advertise base64-backed MCP content should validate that the supplied payload is well-formed and represents the bytes being exposed. Malformed input should reject clearly rather than producing successful content blocks containing invalid encoded data or silently substituted empty content.

## Impact

Tool implementations can inadvertently return invalid image/audio data or silently empty file resources while the MCP call reports success. Clients may fail while decoding content, render missing media, persist corrupted artifacts, or cause agents to reason over absent data without a server-side diagnostic identifying the malformed payload.
