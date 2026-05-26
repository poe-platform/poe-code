# Terminal pilot screen treats wide CJK glyphs as single column cells

## Summary

`terminal-pilot`'s in-memory terminal buffer advances by one cell for every JavaScript character, including CJK glyphs that occupy two columns in a terminal. Screen snapshots and wrapping therefore diverge from the PTY display when commands print wide text.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

describe("wide terminal glyph layout", () => {
  it("lays out following text as though a CJK glyph used one cell", () => {
    const terminal = new TerminalBuffer(3, 2);
    terminal.write("测AB");
    const lines = [terminal.renderLine(0), terminal.renderLine(1)];
    console.log(JSON.stringify({ lines, cursorX: terminal.displayBuffer.cursorX, cursorY: terminal.displayBuffer.cursorY }));
    expect(lines).toEqual(["测AB", ""]);
    expect(terminal.displayBuffer.cursorY).toBe(1);
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"lines":["测AB",""],"cursorX":0,"cursorY":1}
✓ packages/terminal-pilot/src/__probe__.test.ts > wide terminal glyph layout > lays out following text as though a CJK glyph used one cell
```

## Observed Behavior

`TerminalBuffer.write()` processes incoming text character by character, and its normal printable-character path stores one cell then advances `_cursorX` once in `packages/terminal-pilot/src/terminal-buffer.ts`. There is no terminal display-width calculation comparable to the wide-character handling in the separate PNG renderer. On a three-column screen, it stores `测AB` in one rendered line even though `测` visually consumes two terminal columns, and only moves the cursor to the next line after incorrectly writing all three glyphs on the first row.

## Expected Behavior

The terminal screen emulator should account for Unicode display width when placing printable graphemes. In a three-column terminal, the two-column glyph `测` followed by `A` fills the first line and `B` should wrap to the next line; screen text, cursor position, and screenshots should reflect that layout.

## Impact

Interactive commands that render CJK, emoji, or other wide glyphs produce incorrect screen snapshots and cursor geometry in terminal-pilot. Agents reading screen output may select the wrong option, misread aligned UI elements, or capture misleading screenshots whenever terminal content includes common international or symbol characters.
