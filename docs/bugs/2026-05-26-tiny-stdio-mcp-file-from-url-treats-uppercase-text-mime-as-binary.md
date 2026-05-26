# Tiny stdio MCP File.fromUrl treats uppercase text MIME as binary

## Summary

The public `tiny-stdio-mcp-server` `File.fromUrl()` helper classifies fetched resources using a case-sensitive MIME comparison. A valid HTTP response with `Content-Type: Text/Plain; charset=utf-8` is therefore returned as a binary embedded resource containing a base64 `blob`, instead of a textual embedded resource containing the fetched text.

## Reproduction

From the repository root, create and run this disposable Vitest probe:

```sh
cat > packages/tiny-stdio-mcp-server/src/__probe__.test.ts <<'EOF'
import { afterEach, describe, expect, it, vi } from "vitest";
import { File } from "./content/file.js";

describe("File.fromUrl MIME casing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns uppercase text MIME response as a binary blob resource", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("hello", {
      status: 200,
      headers: { "content-type": "Text/Plain; charset=utf-8" }
    })));

    const block = (await File.fromUrl("https://example.test/readme.txt")).toContentBlock();
    console.log(JSON.stringify(block));
    expect(block.resource.mimeType).toBe("Text/Plain");
    expect("blob" in block.resource).toBe(true);
    expect("text" in block.resource).toBe(false);
  });
});
EOF
npm exec -- vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
rm packages/tiny-stdio-mcp-server/src/__probe__.test.ts
```

The probe passes and prints:

```text
{"type":"resource","resource":{"uri":"file:///readme.txt","mimeType":"Text/Plain","blob":"aGVsbG8="}}
```

## Observed Behavior

`File.fromUrl()` successfully fetches UTF-8 text whose response identifies it with the valid media type spelling `Text/Plain`, but `toContentBlock()` emits that resource in binary form: `{ mimeType: "Text/Plain", blob: "aGVsbG8=" }`. Consumers do not receive the expected `text: "hello"` field.

`File.fromUrl()` extracts the response media type verbatim from the `Content-Type` header at `packages/tiny-stdio-mcp-server/src/content/file.ts:38` through `packages/tiny-stdio-mcp-server/src/content/file.ts:64`. It then passes `Text/Plain` into `isTextMimeType()`, whose textual classification at `packages/tiny-stdio-mcp-server/src/content/file.ts:20` through `packages/tiny-stdio-mcp-server/src/content/file.ts:27` uses lowercase string literals and a lowercase `text/` prefix without normalizing MIME case. The value is consequently marked non-textual, and `toContentBlock()` emits a base64 blob at `packages/tiny-stdio-mcp-server/src/content/file.ts:82` through `packages/tiny-stdio-mcp-server/src/content/file.ts:117`.

## Expected Behavior

MIME type matching should be case-insensitive as media type tokens are case-insensitive. A fetched response declaring `Text/Plain; charset=utf-8` should be represented the same way as `text/plain; charset=utf-8`, producing a textual resource with `text: "hello"` rather than a binary blob.

## Impact

MCP tools that embed fetched documents can silently change their returned content shape depending only on capitalization chosen by an upstream HTTP server. Clients expecting readable text may receive opaque base64 blobs instead, losing normal text processing and producing inconsistent behavior for otherwise equivalent remote resources.
