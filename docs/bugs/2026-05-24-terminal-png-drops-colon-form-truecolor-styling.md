# Terminal PNG drops colon-form truecolor styling

## Summary

`terminal-png` does not parse standard colon-separated SGR truecolor parameters such as `CSI 38:2::255:0:0 m`. Direct SDK and CLI input using that 24-bit color form is rendered without its foreground styling, independently of terminal-pilot screen preprocessing.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-png/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi-parser.js";

describe("terminal-png colon truecolor", () => {
  it("drops valid colon-separated RGB foreground styling", () => {
    const runs = parseAnsi("\u001b[38:2::255:0:0mRED");
    console.log(JSON.stringify(runs));
    expect(runs).toEqual([{ text: "RED", fg: null, bg: null, bold: false, italic: false, underline: false, strikethrough: false, dim: false }]);
  });
});
PROBE
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm packages/terminal-png/src/__probe__.test.ts
```

Output:

```text
[{"text":"RED","fg":null,"bg":null,"bold":false,"italic":false,"underline":false,"strikethrough":false,"dim":false}]
✓ packages/terminal-png/src/__probe__.test.ts > terminal-png colon truecolor > drops valid colon-separated RGB foreground styling
```

## Observed Behavior

`parseAnsi()` returns an unstyled `RED` run for a valid colon-form truecolor SGR sequence. `packages/terminal-png/src/ansi-parser.ts` splits SGR parameters only on semicolons; `toInteger()` rejects colon-bearing fields, and `applySgr()` returns without applying color state. Unlike the terminal-pilot report for its screen buffer, this reproduction calls the standalone terminal-png parser directly, so any API consumer rendering terminal text is affected.

## Expected Behavior

The parser and renderer should support both standard parameter separators used for extended colors, mapping this sequence to a foreground color equivalent to RGB `255,0,0` and preserving it in generated SVG/PNG output.

## Impact

Applications that feed modern terminal output directly into `terminal-png` lose syntax highlighting, status colors, selections, and warning emphasis whenever emitters choose colon-form 24-bit ANSI colors. Rendered images can differ materially from the original terminal display.
