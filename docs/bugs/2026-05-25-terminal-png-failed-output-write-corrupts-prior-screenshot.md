# Terminal PNG failed output write corrupts prior screenshot

## Summary

The exported `terminal-png` `renderTerminalPng()` API writes generated PNG bytes directly to an optional output path. If that write partially overwrites an existing screenshot and then rejects, the API reports failure only after the prior valid image has already been corrupted.

## Reproduction

Create a disposable Vitest probe at `packages/terminal-png/src/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { writeFileMock, files } = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  writeFileMock: vi.fn(async (path: string, content: Uint8Array) => {
    files.set(path, Buffer.from(content).subarray(0, 4));
    throw new Error("disk full");
  })
}));

vi.mock("node:fs/promises", () => ({ writeFile: writeFileMock }));

import { renderTerminalPng } from "./index.js";

describe("terminal PNG failed output publication", () => {
  beforeEach(() => {
    files.clear();
    files.set("/tmp/shot.png", Buffer.from("prior valid png"));
    writeFileMock.mockClear();
  });

  it("corrupts the existing output before reporting a failed save", async () => {
    await expect(renderTerminalPng("hello", { output: "/tmp/shot.png" })).rejects.toThrow("disk full");
    console.log(JSON.stringify({ retained: files.get("/tmp/shot.png")?.toString("utf8") }));
    expect(files.get("/tmp/shot.png")?.toString("utf8")).toBe("prior valid png");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm -f packages/terminal-png/src/__probe__.test.ts
```

The probe fails because the previous file is replaced by the partial PNG header before the write error is returned:

```text
{"retained":"�PNG"}
AssertionError: expected '�PNG' to be 'prior valid png'
```

## Observed Behavior

The mocked destination begins with previously valid screenshot contents. During `renderTerminalPng("hello", { output: "/tmp/shot.png" })`, the injected output writer replaces those contents with four generated PNG bytes and throws `disk full`. The public API rejects, but reading the output path afterward returns only the partial PNG prefix rather than the original image.

`packages/terminal-png/src/index.ts` renders the PNG buffer and then persists it with a direct `writeFile(options.output, png)` call. It does not publish through a temporary sibling followed by an atomic rename or provide any rollback for an interrupted replacement.

## Expected Behavior

Saving a newly rendered PNG over an existing output should be atomic from the caller's perspective. If publication fails, the prior valid screenshot should remain intact and the API should reject without destroying usable output.

## Impact

Screenshot generation and visual-validation workflows can lose their last known-good image during transient disk, filesystem, or permission failures. A failed render invocation may therefore destroy review evidence or baseline artifacts while giving callers no usable replacement.
