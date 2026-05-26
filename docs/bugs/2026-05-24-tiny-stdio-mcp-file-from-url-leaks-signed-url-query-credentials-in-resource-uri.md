# Tiny stdio MCP File.fromUrl leaks signed URL query credentials in resource URI

## Summary

`File.fromUrl()` uses the final slash-delimited segment of the source URL as the emitted embedded-resource filename without removing query strings or fragments. When a file is fetched from a signed or token-bearing URL, its returned MCP `resource.uri` therefore discloses the URL credentials to downstream clients alongside the file content.

## Reproduction

From the repository root, run a disposable Vitest probe that fetches a text file from a simulated signed URL and converts it to its MCP resource block:

```sh
cat > /tmp/tiny-stdio-mcp-file-url-query-leak-probe.test.ts <<'PROBE'
import { afterEach, describe, expect, it, vi } from "vitest";
import { File } from "./index.js";

describe("tiny stdio MCP File.fromUrl signed URL", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("copies URL query credentials into the resource URI returned to clients", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("private report").buffer,
      headers: { get: () => "text/plain" },
    }));
    const file = await File.fromUrl("https://cdn.example.test/report.txt?token=secret-token&expires=1#download");
    const block = file.toContentBlock();
    console.log(JSON.stringify(block));
    expect(block.resource.uri).toBe("file:///report.txt?token=secret-token&expires=1#download");
  });
});
PROBE
cp /tmp/tiny-stdio-mcp-file-url-query-leak-probe.test.ts packages/tiny-stdio-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The resource content block repeats the signed URL query and fragment in the returned `file:///` URI:

```text
{"type":"resource","resource":{"uri":"file:///report.txt?token=secret-token&expires=1#download","mimeType":"text/plain","text":"private report"}}
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny stdio MCP File.fromUrl signed URL > copies URL query credentials into the resource URI returned to clients
```

`packages/tiny-stdio-mcp-server/src/content/file.ts:38` through `packages/tiny-stdio-mcp-server/src/content/file.ts:64` set `name` using `url.split("/").pop()` rather than parsing the URL pathname. `packages/tiny-stdio-mcp-server/src/content/file.ts:82` through `packages/tiny-stdio-mcp-server/src/content/file.ts:99` then interpolate that unfiltered name directly into the emitted MCP resource URI.

## Expected Behavior

The resource URI should derive a benign filename from the parsed URL pathname only, or use a neutral URI, without exposing source URL query parameters or fragments. For this input it should not contain `token=secret-token` or other signing metadata.

## Impact

Servers that use signed object-storage downloads, temporary bearer query tokens, or other credential-bearing file URLs can inadvertently transmit those secrets to MCP clients in resource metadata. Those credentials may then be rendered, logged, cached, or propagated beyond the intended fetch boundary.
