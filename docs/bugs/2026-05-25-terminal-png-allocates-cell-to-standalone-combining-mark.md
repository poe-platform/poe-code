---
name: "Terminal PNG allocates cell to standalone combining mark"
---

# Terminal PNG allocates cell to standalone combining mark

## Summary

`terminal-png` measures a standalone Unicode combining mark as a full monospace terminal cell. A zero-width diacritic such as U+0301 COMBINING ACUTE ACCENT therefore expands rendered screenshot width exactly like a visible ASCII character.

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

describe("standalone combining-mark width", () => {
  it("allocates a visible cell to a zero-width combining mark", () => {
    const empty = width(renderSvg(parseAnsi(""), { padding: 0, window: false }));
    const combining = width(renderSvg(parseAnsi("\u0301"), { padding: 0, window: false }));
    const oneCell = width(renderSvg(parseAnsi("A"), { padding: 0, window: false }));

    console.log(JSON.stringify({ empty, combining, oneCell }));
    expect(combining).toBe(empty);
    expect(combining).not.toBe(oneCell);
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm -f packages/terminal-png/src/__probe__.test.ts
```

The probe fails because the combining mark is measured as exactly one visible cell:

```text
{"empty":0,"combining":8.41,"oneCell":8.41}
AssertionError: expected 8.41 to be 0
```

## Observed Behavior

With padding and window decoration disabled, an empty render has width `0`, while a single U+0301 combining mark has width `8.41`, the same as the visible character `A`. The mark creates horizontal space despite having no cell width of its own in terminal display.

`displayWidth()` in `packages/terminal-png/src/svg-renderer.ts` iterates grapheme segments and increments width by either one or two for every segment. It has no zero-width category for combining or nonspacing marks, so a standalone combining mark always increments the measured line width by one cell.

## Expected Behavior

Terminal screenshot layout should assign zero cells to standalone combining marks and other zero-width graphemes rather than widening output as if a printable character were present.

## Impact

Terminal output containing decomposed text fragments, cursor annotations, or malformed-but-displayable Unicode marks renders with spurious horizontal gaps. Snapshot-based visual validation and generated terminal images can show incorrect alignment and wrapping compared with an actual terminal.
