# Tiny stdio MCP File.fromUrl corrupts declared non-UTF-8 text

## Summary

The public `tiny-stdio-mcp-server` `File.fromUrl()` helper classifies remotely fetched `text/*` responses as text resources but always decodes their bytes as UTF-8. A valid response that declares another character encoding, such as `text/plain; charset=iso-8859-1`, is returned with replacement characters instead of the transmitted text.

## Reproduction

Create a disposable probe at `packages/tiny-stdio-mcp-server/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { File } from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tiny-stdio remote text charset handling", () => {
  it("corrupts latin-1 text declared by the response charset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=iso-8859-1" }
        })
      )
    );

    const file = await File.fromUrl("https://example.test/cafe.txt");
    const block = file.toContentBlock();

    expect(block.resource).toMatchObject({ text: "caf�" });
    expect(block.resource).not.toMatchObject({ text: "café" });
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
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny-stdio remote text charset handling > corrupts latin-1 text declared by the response charset
```

## Observed Behavior

`File.fromUrl()` receives the remote bytes and uses the response `Content-Type` header when no binary signature is detected at `packages/tiny-stdio-mcp-server/src/content/file.ts:38` through `packages/tiny-stdio-mcp-server/src/content/file.ts:64`. Its text classification considers any `text/*` MIME type textual at `packages/tiny-stdio-mcp-server/src/content/file.ts:20` through `packages/tiny-stdio-mcp-server/src/content/file.ts:27`, but it discards all charset parameters while extracting the MIME type at line 53. Later, `toContentBlock()` unconditionally decodes every textual byte payload through `new TextDecoder("utf-8")` at `packages/tiny-stdio-mcp-server/src/content/file.ts:82` through `packages/tiny-stdio-mcp-server/src/content/file.ts:100`. For the valid ISO-8859-1 bytes representing `café`, the emitted text is `caf�`.

## Expected Behavior

When converting fetched textual resources into MCP content, the helper should respect a declared supported charset or preserve the bytes as a blob when it cannot decode them correctly. A successful fetch must not silently corrupt content solely because it is not encoded as UTF-8.

## Impact

Tools retrieving legitimate text files from servers that use Latin-1 or other non-UTF-8 encodings deliver corrupted content to clients and agents while reporting success. This can alter instructions, source files, logs, or data documents and cause downstream reasoning or transformations to act on incorrect text without any error indicating data loss.
