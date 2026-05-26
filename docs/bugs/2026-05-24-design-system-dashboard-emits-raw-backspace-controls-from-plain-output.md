# Design system dashboard emits raw backspace controls from plain output

## Summary

The design-system dashboard handles text without ESC-prefixed ANSI sequences through a separate plain-output path that does not sanitize or interpret terminal control characters. A captured message containing backspace overstrike output therefore becomes a dashboard cell containing the raw `BS` control byte, which is emitted back to the terminal rather than rendered as the visibly replaced text.

## Reproduction

From the repository root, run a disposable Vitest probe through the dashboard renderer and its cell-to-terminal output conversion:

```sh
cat > packages/design-system/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { ScreenBuffer, cellToAnsi } from "./dashboard/buffer.js";
import { renderOutputPane } from "./dashboard/components/output-pane.js";

describe("dashboard plain backspace controls", () => {
  it("emits an unescaped backspace control from captured plain output", () => {
    const buffer = new ScreenBuffer(20, 1);
    renderOutputPane(buffer, { x: 0, y: 0, width: 20, height: 1 }, [
      { kind: "status", text: "ok\bX", ts: 0 }
    ]);
    const renderedCells = Array.from({ length: 6 }, (_, x) => buffer.get(x, 0).ch).join("");
    const outputForControlCell = cellToAnsi(buffer.get(5, 0));
    console.log(JSON.stringify({ renderedCells, outputForControlCell }));
    expect(buffer.get(5, 0).ch).toBe("\b");
    expect(outputForControlCell).toContain("\b");
  });
});
EOF
trap 'rm -f packages/design-system/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
nl -ba packages/design-system/src/dashboard/components/output-pane.ts | sed -n '83,115p;205,250p'
nl -ba packages/design-system/src/dashboard/buffer.ts | sed -n '89,124p;158,190p'
```

## Observed Behavior

The dashboard stores the backspace as a cell and serializes it back into terminal output:

```text
{"renderedCells":"●  ok\b","outputForControlCell":"\u001b[35m\b\u001b[0m"}
✓ packages/design-system/src/__probe__.test.ts > dashboard plain backspace controls > emits an unescaped backspace control from captured plain output
```

`computeVisualLines()` sends any item without `ESC` through `wrapText()` in `packages/design-system/src/dashboard/components/output-pane.ts:83`, so a plain backspace never reaches the control-filtering logic in `parseAnsi()`. `ScreenBuffer.putInRect()` writes each resulting character, including `\b`, as an ordinary screen cell in `packages/design-system/src/dashboard/buffer.ts:89`, and `cellToAnsi()` later returns that raw control as emitted terminal content from `packages/design-system/src/dashboard/buffer.ts:158`.

## Expected Behavior

Dashboard rendering should interpret backspace as terminal cursor movement/overstrike or otherwise safely normalize it before filling screen cells. For captured output `ok\bX`, the visible dashboard result should reflect the terminal display (`oX`) rather than injecting a raw control byte during dashboard redraw.

## Impact

Programs use backspace for in-place corrections, progress effects, and compact terminal animation. Displaying their captured output can corrupt dashboard positioning during redraw, overwrite adjacent pane content, or show misleading status text because an item's embedded controls are executed against the dashboard itself rather than rendered as the item's final visible state.
