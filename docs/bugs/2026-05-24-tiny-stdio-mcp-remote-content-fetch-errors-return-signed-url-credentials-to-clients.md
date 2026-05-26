# Tiny stdio MCP remote content fetch errors return signed URL credentials to clients

## Summary

The remote-content helpers in `tiny-stdio-mcp-server` include the complete source URL in errors when a fetch fails. When a tool loads an image, audio file, or file from a signed URL and that fetch fails, the server converts the thrown message into ordinary MCP error content, disclosing query-string credentials such as access tokens or signatures to the calling client.

## Reproduction

From the repository root, run a disposable Vitest probe that defines a tool returning `Image.fromUrl()` for a simulated signed URL whose fetch is rejected:

```sh
cat > /tmp/tiny-stdio-mcp-content-fetch-error-client-leak-probe.test.ts <<'PROBE'
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, defineSchema, Image } from "./index.js";

describe("tiny stdio MCP content fetch error client disclosure", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns signed URL credentials in a failed tool result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden" }));
    const server = createServer({ name: "probe", version: "1" }).tool("load", "Load image", defineSchema({}), () =>
      Image.fromUrl("https://cdn.example.test/private.png?token=secret-token&signature=abc")
    );
    await server.handleMessage("initialize", {});
    const response = await server.handleMessage("tools/call", { name: "load", arguments: {} });
    console.log(JSON.stringify(response));
    expect(response.result).toEqual({
      content: [{ type: "text", text: "Error: Failed to fetch image from https://cdn.example.test/private.png?token=secret-token&signature=abc: 403 Forbidden" }],
      isError: true,
    });
  });
});
PROBE
cp /tmp/tiny-stdio-mcp-content-fetch-error-client-leak-probe.test.ts packages/tiny-stdio-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The failed tool result exposes the full signed image URL in its client-visible text content:

```text
{"result":{"content":[{"type":"text","text":"Error: Failed to fetch image from https://cdn.example.test/private.png?token=secret-token&signature=abc: 403 Forbidden"}],"isError":true}}
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny stdio MCP content fetch error client disclosure > returns signed URL credentials in a failed tool result
```

`packages/tiny-stdio-mcp-server/src/content/image.ts:22` through `packages/tiny-stdio-mcp-server/src/content/image.ts:26` interpolate the full unredacted input URL into a thrown failure message; the same pattern also exists in `packages/tiny-stdio-mcp-server/src/content/audio.ts:30` through `packages/tiny-stdio-mcp-server/src/content/audio.ts:34` and `packages/tiny-stdio-mcp-server/src/content/file.ts:38` through `packages/tiny-stdio-mcp-server/src/content/file.ts:42`. `packages/tiny-stdio-mcp-server/src/server.ts:142` through `packages/tiny-stdio-mcp-server/src/server.ts:158` serialize arbitrary handler exceptions into returned `isError` content, forwarding that URL to clients.

## Expected Behavior

Errors returned to MCP clients should not include secrets embedded in source URL query parameters or fragments. Remote-content failures should redact the URL, retain only a safe pathname or origin description, or surface a sanitized fetch error.

## Impact

A failed protected download can exfiltrate temporary object-storage signatures, bearer query credentials, or other sensitive URL parameters to whichever MCP client invoked the tool. Those secrets can then appear in UI transcripts, model context, logs, or persisted tool-result histories.
