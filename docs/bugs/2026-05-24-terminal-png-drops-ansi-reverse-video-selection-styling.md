# Terminal PNG drops ANSI reverse video selection styling

## Summary

`terminal-png` ignores the standard ANSI SGR reverse-video sequence (`\u001b[7m`). Text displayed by terminal interfaces as an inverted selection or focus highlight is parsed and rendered as unstyled ordinary text, losing a common interactive-state indicator in PNG captures.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-png/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi-parser.js";

describe("inverse video ANSI style", () => {
  it("drops SGR reverse-video entirely from styled runs", () => {
    const runs = parseAnsi("\u001b[7mSELECTED\u001b[0m");
    console.log(JSON.stringify(runs));
    expect(runs[0]).toMatchObject({ text: "SELECTED", fg: null, bg: null });
  });
});
PROBE
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm packages/terminal-png/src/__probe__.test.ts
```

Output:

```text
[{"text":"SELECTED","fg":null,"bg":null,"bold":false,"italic":false,"underline":false,"strikethrough":false,"dim":false}]
✓ packages/terminal-png/src/__probe__.test.ts > inverse video ANSI style > drops SGR reverse-video entirely from styled runs
```

## Observed Behavior

The parser's `StyledRun` model in `packages/terminal-png/src/ansi-parser.ts` tracks foreground color, background color, bold, italic, underline, strikethrough, and dim state, but has no representation for reverse video. Its SGR handling recognizes several style codes yet does not process SGR `7` or `27`, so `\u001b[7mSELECTED\u001b[0m` produces a plain run with no distinguishing style. The downstream SVG and PNG renderers therefore cannot show the inverted selected-state appearance emitted by a terminal program.

## Expected Behavior

ANSI terminal screenshot rendering should preserve standard reverse-video output by swapping effective foreground and background colors while the SGR state is active, and reset that styling on SGR `27` or full reset. Selected menu rows and focused fields should remain visibly selected in the rendered image.

## Impact

Many interactive terminal applications use reverse video instead of explicit colors to indicate the current selection or cursor focus. PNG captures produced for visual testing or agent interaction can make selectable rows appear indistinguishable, causing incorrect interpretation of which action is active even when the live terminal display is clear.
