# Terminal PNG exported font list mutation redirects future rendering

## Summary

The public `@poe-code/terminal-png` package exports `JETBRAINS_MONO_FONT_FILES` as a compile-time constant tuple, but its runtime array is mutable. A caller that reads the exported font metadata can replace one path, and later `renderPng()` calls forward the mutated external font path into `Resvg` instead of rendering with the package's bundled JetBrains Mono asset set.

## Reproduction

Create a disposable probe at `packages/terminal-png/src/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JETBRAINS_MONO_FONT_FILES } from "./font.js";

const renderMock = vi.hoisted(() => vi.fn(() => ({ asPng: () => Buffer.from("png") })));
const constructorMock = vi.hoisted(() => vi.fn());

vi.mock("@resvg/resvg-js", () => ({
  Resvg: class {
    constructor(svg: string, options: unknown) {
      constructorMock(svg, options);
    }
    render = renderMock;
  }
}));

import { renderPng } from "./png-renderer.js";

describe("terminal-png exported font list mutation", () => {
  beforeEach(() => {
    constructorMock.mockClear();
    renderMock.mockClear();
  });

  it("redirects font files used by later PNG renders", () => {
    const mutableFonts = JETBRAINS_MONO_FONT_FILES as unknown as string[];
    const original = mutableFonts[0]!;
    mutableFonts[0] = "/tmp/unexpected-font.ttf";

    try {
      renderPng("<svg />");
      expect(constructorMock.mock.calls[0]?.[1]).toMatchObject({
        font: { fontFiles: ["/tmp/unexpected-font.ttf", expect.any(String), expect.any(String), expect.any(String)] }
      });
    } finally {
      mutableFonts[0] = original;
    }
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm -f packages/terminal-png/src/__probe__.test.ts
```

The probe passes, confirming that a mutation through the public export controls a future render's font configuration:

```text
✓ packages/terminal-png/src/__probe__.test.ts > terminal-png exported font list mutation > redirects font files used by later PNG renders
```

## Observed Behavior

`packages/terminal-png/src/font.ts:31` through `packages/terminal-png/src/font.ts:37` construct and export `JETBRAINS_MONO_FONT_FILES` as an ordinary array. The public barrel re-exports it through `packages/terminal-png/src/index.ts`. `renderPng()` creates each `Resvg` renderer using `fontFiles: [...JETBRAINS_MONO_FONT_FILES]` at `packages/terminal-png/src/png-renderer.ts:4` through `packages/terminal-png/src/png-renderer.ts:18`, so it copies whatever paths are currently present in the externally mutable exported array. In the probe, changing index zero to `/tmp/unexpected-font.ttf` causes the next render to request that replacement path.

## Expected Behavior

Reading public font metadata must not allow callers to change the font assets used by future rendering operations. Exported font lists should be frozen or defensively copied, and `renderPng()` should use immutable package-owned configuration.

## Impact

Any same-process consumer can alter the font source of later screenshots, causing unexpected font loading, failed renders when a substituted path is missing, or visual output that no longer corresponds to the package's declared bundled font assets. Render behavior becomes dependent on unrelated metadata-inspection code executed earlier in the process.
