# Terminal PNG renders backspace overstrikes as embedded control text

## Summary

`terminal-png` accepts terminal output for screenshot rendering, but it treats the backspace control character (`BS`, `0x08`) as ordinary printable text. A command that overstrikes a previously emitted character using backspace produces an SVG text run containing both the superseded content and the raw control byte rather than the final visible terminal cells.

## Reproduction

Add the following temporary probe as `packages/terminal-png/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseAnsi } from "./ansi-parser.js";
import { renderSvg } from "./svg-renderer.js";

describe("terminal backspace layout", () => {
  it("renders the erased character and backspace instead of the final cell contents", () => {
    const runs = parseAnsi("PASS\bF");
    const svg = renderSvg(runs, { window: false, padding: 0 });

    console.log(JSON.stringify({ runs, includesRawBackspace: svg.includes("PASS\bF") }));

    expect(runs[0]?.text).toBe("PASS\bF");
    expect(svg).toContain("PASS\bF");
  });
});
```

Run:

```sh
npm exec vitest run -- packages/terminal-png/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"runs":[{"text":"PASS\bF","fg":null,"bg":null,"bold":false,"italic":false,"underline":false,"strikethrough":false,"dim":false}],"includesRawBackspace":true}
✓ packages/terminal-png/src/__probe__.test.ts > terminal backspace layout > renders the erased character and backspace instead of the final cell contents
```

Remove the temporary probe after confirming the reproduction.

## Observed Behavior

The stream `PASS\bF` is preserved as a single rendered text run containing the raw backspace byte. `parseAnsi()` in `packages/terminal-png/src/ansi-parser.ts` only handles newlines and escape-prefixed CSI sequences specially; it leaves `BS` inside ordinary text. `renderSvg()` then emits that text run into the image without applying terminal cursor movement, so the output is not a faithful depiction of the terminal display.

## Expected Behavior

Backspace should move the terminal cursor one cell to the left without itself being rendered. Subsequent output should overwrite the affected visible cell, so `PASS\bF` should render as `PASF` rather than an embedded-control representation of the original stream.

## Impact

Terminal output commonly uses backspace for overstriking, lightweight progress animation, masking, and corrections. Screenshots generated from such output can show stale or control-laden text rather than the visible terminal result, causing misleading visual evidence and incorrect agent interpretation of command state.
