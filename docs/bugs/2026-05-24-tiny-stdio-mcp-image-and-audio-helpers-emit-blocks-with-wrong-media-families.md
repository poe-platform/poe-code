# Tiny stdio MCP image and audio helpers emit blocks with wrong media families

## Summary

The `Image` and `Audio` content helpers accept arbitrary explicit MIME values without requiring them to match the content-block family being emitted. Callers can therefore create an MCP `image` block whose `mimeType` is `audio/mpeg`, and an `audio` block whose `mimeType` is `image/png`.

## Reproduction

From the repository root, run a disposable Vitest probe that constructs both block types with explicit MIME types from the opposite media family:

```sh
cat > /tmp/tiny-stdio-mcp-media-family-probe.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { Audio, Image, toContentBlocks } from "./index.js";

describe("tiny stdio MCP rich content MIME families", () => {
  it("emits image and audio blocks carrying the wrong MIME families", () => {
    const image = toContentBlocks(Image.fromBytes(new Uint8Array([1, 2, 3]), "audio/mpeg"));
    const audio = toContentBlocks(Audio.fromBytes(new Uint8Array([4, 5, 6]), "image/png"));
    console.log(JSON.stringify({ image, audio }));
    expect(image).toEqual([{ type: "image", data: "AQID", mimeType: "audio/mpeg" }]);
    expect(audio).toEqual([{ type: "audio", data: "BAUG", mimeType: "image/png" }]);
  });
});
PROBE
cp /tmp/tiny-stdio-mcp-media-family-probe.test.ts packages/tiny-stdio-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Both content blocks are emitted with MIME types that contradict their MCP content `type`:

```text
{"image":[{"type":"image","data":"AQID","mimeType":"audio/mpeg"}],"audio":[{"type":"audio","data":"BAUG","mimeType":"image/png"}]}
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny stdio MCP rich content MIME families > emits image and audio blocks carrying the wrong MIME families
```

`packages/tiny-stdio-mcp-server/src/content/image.ts:49` through `packages/tiny-stdio-mcp-server/src/content/image.ts:63` accept any supplied format string and preserve an already-qualified MIME value without checking the supported image MIME set used by `fromUrl()`. `packages/tiny-stdio-mcp-server/src/content/audio.ts:57` through `packages/tiny-stdio-mcp-server/src/content/audio.ts:75` likewise accept any slash-qualified string without requiring an `audio/*` MIME. Each helper then emits that value unchanged in its content block.

## Expected Behavior

`Image` constructors should accept only supported `image/*` MIME values and `Audio` constructors should accept only supported `audio/*` MIME values, or reject incompatible explicit format arguments before emitting invalid MCP content blocks.

## Impact

Tools can produce internally contradictory rich content that clients may render incorrectly, reject, misroute to unsuitable decoders, or persist with misleading metadata. The helpers fail to preserve the basic contract promised by their strongly typed `image` and `audio` content abstractions.
