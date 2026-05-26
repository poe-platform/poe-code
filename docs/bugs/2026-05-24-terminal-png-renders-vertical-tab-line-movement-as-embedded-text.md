# Terminal PNG renders vertical-tab line movement as embedded text

## Summary

`terminal-png` treats the vertical tab terminal control (`VT`, `0x0b`) as ordinary text when rendering terminal output. A stream that uses `VT` to move vertically produces an SVG containing the raw control byte inline with surrounding text rather than placing subsequent output on the following display row.

## Reproduction

Add the following temporary probe as `packages/terminal-png/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseAnsi } from "./ansi-parser.js";
import { renderSvg } from "./svg-renderer.js";

describe("vertical tab terminal output", () => {
  it("renders VT as embedded text instead of moving down a line", () => {
    const runs = parseAnsi("A\vB");
    const svg = renderSvg(runs, { window: false, padding: 0 });

    console.log(JSON.stringify({ runs, includesRawVerticalTab: svg.includes("A\vB") }));

    expect(runs[0]?.text).toBe("A\vB");
    expect(svg).toContain("A\vB");
  });
});
```

Run:

```sh
npm exec vitest run -- packages/terminal-png/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"runs":[{"text":"A\u000bB","fg":null,"bg":null,"bold":false,"italic":false,"underline":false,"strikethrough":false,"dim":false}],"includesRawVerticalTab":true}
✓ packages/terminal-png/src/__probe__.test.ts > vertical tab terminal output > renders VT as embedded text instead of moving down a line
```

Remove the temporary probe after confirming the reproduction.

## Observed Behavior

The stream `A\vB` remains a single text run containing the raw `VT` control. `parseAnsi()` in `packages/terminal-png/src/ansi-parser.ts` special-cases only newline and escape-prefixed CSI input, and `renderSvg()` lays out lines from newline-delimited runs only. Consequently, the screenshot output contains inline control text rather than a second rendered row for `B`.

## Expected Behavior

Terminal vertical tab output should move the cursor down by one row using terminal line-movement behavior, analogous to line feed for ordinary terminal display. Rendering `A\vB` should place `A` on one row and `B` on the following row, without emitting the control byte as image text.

## Impact

Programs and captured logs that use vertical movement controls can generate terminal screenshots with flattened or control-laden output. This makes multiline status displays, legacy command output, and terminal-capture evidence inaccurate for users and agents interpreting visual results.
