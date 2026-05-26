# Terminal PNG measures tab characters as single cells

## Summary

`terminal-png` measures every non-wide grapheme as one monospace cell, including horizontal tab characters. Terminal output containing `\t` is therefore rendered far narrower than it appears in an actual terminal, where tabs advance to a tab stop.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-png/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi-parser.js";
import { renderSvg } from "./svg-renderer.js";

describe("terminal tab layout", () => {
  it("measures a horizontal tab as one glyph instead of tab-stop spacing", () => {
    const plain = renderSvg(parseAnsi("AB"), { window: false, padding: 0 });
    const tabbed = renderSvg(parseAnsi("A\tB"), { window: false, padding: 0 });
    const plainWidth = plain.match(/width="([^"]+)"/)?.[1];
    const tabbedWidth = tabbed.match(/width="([^"]+)"/)?.[1];
    console.log(JSON.stringify({ plainWidth, tabbedWidth }));
    expect(tabbedWidth).toBe("25.24");
  });
});
PROBE
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm packages/terminal-png/src/__probe__.test.ts
```

Output:

```text
{"plainWidth":"16.83","tabbedWidth":"25.24"}
✓ packages/terminal-png/src/__probe__.test.ts > terminal tab layout > measures a horizontal tab as one glyph instead of tab-stop spacing
```

## Observed Behavior

`renderSvg()` sizes terminal output using `measureLines()` and `displayWidth()` in `packages/terminal-png/src/svg-renderer.ts`. `displayWidth()` iterates grapheme segments and increases width by two only for selected wide Unicode code points; all remaining input, including the tab character, contributes one character width. Thus `A\tB` is measured as exactly three single cells (`25.24px`) rather than placing `B` at the next terminal tab stop.

## Expected Behavior

Terminal rendering should expand tabs according to terminal tab-stop behavior, conventionally advancing to the next eight-column stop from the current cursor position. Content after a tab should be positioned at the same visible column it occupies in the captured terminal.

## Impact

Screenshots of tabular output, formatted logs, help text, and command displays containing tabs show compressed and misaligned columns. Visual regression checks and agents interpreting rendered terminal layouts can draw incorrect conclusions about alignment and readable structure.
