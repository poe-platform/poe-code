# Tiny stdio MCP File.fromText emits text content for binary MIME

## Summary

The public `tiny-stdio-mcp-server` `File.fromText()` helper accepts an arbitrary MIME type but unconditionally records its content as textual. Passing an explicitly binary MIME type such as `application/octet-stream` returns a successful embedded resource containing a `text` field rather than the `blob` representation required for non-text resource bytes.

## Reproduction

Create a disposable probe at `packages/tiny-stdio-mcp-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { File } from "./index.js";

describe("tiny-stdio File.fromText MIME shape", () => {
  it("emits text fields for an explicitly binary MIME type", () => {
    const block = File.fromText("secret", "application/octet-stream").toContentBlock();

    expect(block).toEqual({
      type: "resource",
      resource: {
        uri: "file:///data",
        mimeType: "application/octet-stream",
        text: "secret"
      }
    });
    expect("blob" in block.resource).toBe(false);
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
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny-stdio File.fromText MIME shape > emits text fields for an explicitly binary MIME type
```

## Observed Behavior

The exported resource content contract distinguishes textual resources carrying `text` from binary resources carrying `blob` in `packages/tiny-stdio-mcp-server/src/content/file.ts:3` through `packages/tiny-stdio-mcp-server/src/content/file.ts:18`. `File.fromText()` accepts a caller-provided MIME type but sets its internal `isText` flag to `true` unconditionally at `packages/tiny-stdio-mcp-server/src/content/file.ts:72` through `packages/tiny-stdio-mcp-server/src/content/file.ts:74`. `toContentBlock()` selects its output variant from that flag at `packages/tiny-stdio-mcp-server/src/content/file.ts:82` through `packages/tiny-stdio-mcp-server/src/content/file.ts:117`, so `File.fromText("secret", "application/octet-stream")` emits `{ mimeType: "application/octet-stream", text: "secret" }` instead of binary resource content.

## Expected Behavior

The helper should reject MIME types inconsistent with its text constructor, or encode content according to the declared MIME family so a non-text resource is emitted with a base64 `blob`. Successful MCP resource blocks should not contradict their declared media representation.

## Impact

Tool implementations can publish binary-labelled resources in a textual shape that clients may render, decode, or persist incorrectly. This creates successful but internally inconsistent MCP output and can corrupt downstream file handling or mislead agents about the type of returned artifact.
