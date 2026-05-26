# Terminal pilot screen ignores repeat preceding character control

## Summary

`terminal-pilot` ignores the standard ANSI/ECMA-48 `CSI Ps b` repeat-preceding-character control (REP). Terminal applications that compact repeated glyph output with REP appear to omit characters entirely in `screen()` results and screenshots.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

describe("repeat preceding character control", () => {
  it("ignores CSI REP instead of repeating the displayed glyph", () => {
    const buffer = new TerminalBuffer(10, 2);
    buffer.write("A\u001b[4b");

    const lines = [buffer.renderLine(0), buffer.renderLine(1)];
    console.log(JSON.stringify(lines));
    expect(lines).toEqual(["A", ""]);
  });
});
PROBE
npx vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter=verbose
rm -f packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["A",""]
✓ packages/terminal-pilot/src/__probe__.test.ts > repeat preceding character control > ignores CSI REP instead of repeating the displayed glyph
```

## Observed Behavior

The stream writes one `A` and then emits `CSI 4 b`, which should append four additional copies of the immediately preceding displayed character. The resulting screen line remains only `A`. `packages/terminal-pilot/src/terminal-buffer.ts:195` through `packages/terminal-pilot/src/terminal-buffer.ts:353` implement many CSI final bytes but contain no `case "b"` for REP, so the parsed command falls through the default no-op branch after `packages/terminal-pilot/src/terminal-buffer.ts:507` through `packages/terminal-pilot/src/terminal-buffer.ts:520` consume it.

## Expected Behavior

After writing `A\u001b[4b`, terminal-pilot should display `AAAAA` on the first line, applying the repeat count to the preceding character with normal wrapping behavior when repetition reaches the display margin.

## Impact

Terminal UIs may use REP to efficiently draw separators, progress bars, rulers, padding, or repeated status glyphs. Terminal-pilot screen reads and generated screenshots silently lose those repeated visual elements, making layouts incomplete and causing automation to misread progress indicators, selection regions, and interface structure.
