---
name: "Terminal PNG measures flag emoji as one cell"
---

# Terminal PNG measures flag emoji as one cell

## Summary

`terminal-png` renders Unicode regional-indicator flag emoji at the width of a single monospace terminal cell. A flag such as `🇺🇸`, which occupies two cells in ordinary terminal rendering, therefore produces an SVG/PNG layout that is too narrow and can crowd following content.

## Reproduction

Create a disposable Vitest probe at `packages/terminal-png/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi-parser.js";
import { renderSvg } from "./svg-renderer.js";

function width(svg: string): number {
  const match = svg.match(/width="([0-9.]+)"/);
  if (!match) throw new Error("missing width");
  return Number(match[1]);
}

describe("terminal flag emoji width", () => {
  it("measures a two-cell regional-indicator flag as one terminal cell", () => {
    const oneCell = width(renderSvg(parseAnsi("A"), { padding: 0, window: false }));
    const flag = width(renderSvg(parseAnsi("🇺🇸"), { padding: 0, window: false }));
    const twoCells = width(renderSvg(parseAnsi("AB"), { padding: 0, window: false }));

    console.log(JSON.stringify({ oneCell, flag, twoCells }));
    expect(flag).toBe(twoCells);
    expect(flag).not.toBe(oneCell);
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm -f packages/terminal-png/src/__probe__.test.ts
```

The probe fails because the flag is assigned exactly the single-cell width:

```text
{"oneCell":8.41,"flag":8.41,"twoCells":16.83}
AssertionError: expected 8.41 to be 16.83
```

## Observed Behavior

Rendering `🇺🇸` with zero padding produces an SVG width of `8.41`, identical to plain `A`, instead of the `16.83` width produced by two normal terminal cells. The flag glyph is consequently laid out as if it took one cell.

`displayWidth()` in `packages/terminal-png/src/svg-renderer.ts` segments the text into grapheme clusters, then assigns two cells only when the first code point matches `isWideCodePoint()`. A regional-indicator flag is one grapheme whose first code point lies outside the hard-coded wide ranges, so the complete two-code-point flag cluster contributes one cell.

## Expected Behavior

Terminal screenshot sizing should measure rendered grapheme clusters according to their terminal display width. Regional-indicator flag emoji should consume two monospace cells, consistent with other wide emoji already handled by the renderer.

## Impact

Screenshots containing flag icons, locale selectors, country status labels, or prompt decorations are rendered with incorrect alignment and clipped or crowded columns. Visual CLI validations can therefore approve layouts that will not match the same content in an actual terminal.
