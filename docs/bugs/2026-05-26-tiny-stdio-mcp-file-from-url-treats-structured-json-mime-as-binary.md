# Tiny stdio MCP File.fromUrl treats structured JSON MIME as binary

## Summary

The public `tiny-stdio-mcp-server` `File.fromUrl()` helper recognizes only the exact `application/json` media type as textual JSON. Valid structured JSON media types such as `application/problem+json` are therefore returned as binary embedded resources containing base64 `blob` data rather than readable `text` content.

## Reproduction

From the repository root, create and run this disposable Vitest probe:

```sh
cat > packages/tiny-stdio-mcp-server/src/__probe__.test.ts <<'EOF'
import { afterEach, describe, expect, it, vi } from "vitest";
import { File } from "./content/file.js";

describe("File structured JSON MIME handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns application/problem+json response as a binary blob resource", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"title":"failed"}', {
      status: 200,
      headers: { "content-type": "application/problem+json; charset=utf-8" }
    })));

    const block = (await File.fromUrl("https://example.test/error.json")).toContentBlock();
    console.log(JSON.stringify(block));
    expect(block.resource.mimeType).toBe("application/problem+json");
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
{"type":"resource","resource":{"uri":"file:///error.json","mimeType":"application/problem+json","blob":"eyJ0aXRsZSI6ImZhaWxlZCJ9"}}
```

## Observed Behavior

`File.fromUrl()` successfully fetches a UTF-8 JSON document declared with the standards-based `application/problem+json` media type, but `toContentBlock()` emits a binary resource with a base64 `blob` instead of exposing its JSON as `text`.

When no binary magic bytes are detected, `File.fromUrl()` takes the response media type from the `Content-Type` header at `packages/tiny-stdio-mcp-server/src/content/file.ts:47` through `packages/tiny-stdio-mcp-server/src/content/file.ts:64`. It then classifies the result through `isTextMimeType()`, which only special-cases the exact strings `application/json` and `application/xml` at `packages/tiny-stdio-mcp-server/src/content/file.ts:20` through `packages/tiny-stdio-mcp-server/src/content/file.ts:27`. Since `application/problem+json` is not accepted, `toContentBlock()` selects the base64 branch at `packages/tiny-stdio-mcp-server/src/content/file.ts:82` through `packages/tiny-stdio-mcp-server/src/content/file.ts:117`.

## Expected Behavior

Structured JSON media types ending in `+json`, including `application/problem+json`, should be handled as textual JSON content just like `application/json`, producing a resource with `text: '{"title":"failed"}'` rather than a binary base64 `blob`.

## Impact

MCP tools that fetch problem details, JSON-LD, ActivityStreams, vendor API documents, or other structured JSON resources silently return opaque blobs rather than readable content. Clients and agents lose ordinary JSON inspection and reasoning for valid JSON resources based solely on their registered media type suffix.
