# Terminal PNG drops parsed ANSI background colors from images

## Summary

`terminal-png` parses ANSI background-color SGR sequences into its `StyledRun.bg` model, but `renderSvg()` never renders run backgrounds. Terminal output that relies on highlighted backgrounds, selection states, or error banners therefore loses those visual semantics in generated PNG screenshots.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-png/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi-parser.js";
import { renderSvg } from "./svg-renderer.js";

describe("ANSI background rendering", () => {
  it("parses background color but omits it from the rendered screenshot", () => {
    const runs = parseAnsi("\u001b[41mERROR\u001b[0m");
    const svg = renderSvg(runs, { window: false });
    console.log(JSON.stringify({ bg: runs[0]?.bg, hasRed: svg.includes("#D74E6F") }));
    expect(runs[0]?.bg).toEqual({ type: "ansi4", index: 1 });
    expect(svg).not.toContain("#D74E6F");
  });
});
PROBE
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm packages/terminal-png/src/__probe__.test.ts
```

Output:

```text
{"bg":{"type":"ansi4","index":1},"hasRed":false}
✓ packages/terminal-png/src/__probe__.test.ts > ANSI background rendering > parses background color but omits it from the rendered screenshot
```

## Observed Behavior

`StyledRun` includes a `bg` color property and `parseAnsi()` applies SGR background color values in `packages/terminal-png/src/ansi-parser.ts`. The reproduction confirms that `\u001b[41m` produces `{ type: "ansi4", index: 1 }` in the run. However, `renderRun()` in `packages/terminal-png/src/svg-renderer.ts` only emits foreground `fill`, font weight/style, decorations, and opacity; it does not inspect `run.bg` or emit any background rectangle. The resulting SVG contains no parsed red background color.

## Expected Behavior

Rendering ANSI terminal content to an image should preserve parsed background colors by drawing appropriately sized colored cells or spans behind text. A run rendered under SGR background red should visibly display that red background in the generated SVG and PNG.

## Impact

Generated screenshots misrepresent terminal UIs that use background styling for selected menu items, diff highlights, warnings, statuses, or focus. Visual testing and agent-based UI interpretation can miss the most important state indicator even though the parser already captures the required styling data.
