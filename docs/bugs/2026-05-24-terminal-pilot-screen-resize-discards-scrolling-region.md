---
name: "Terminal pilot screen resize discards scrolling region"
---

# Terminal pilot screen resize discards scrolling region

## Summary

`terminal-pilot` unconditionally resets the configured scrolling region to the full viewport whenever its screen buffer is resized, even when terminal dimensions do not change. A terminal UI with fixed header or footer rows can therefore begin scrolling those protected rows after an ordinary resize notification.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

describe("resize scroll-region retention", () => {
  it("drops configured margins so later bottom-row scrolling moves a fixed header", () => {
    const buffer = new TerminalBuffer(6, 4);
    buffer.write("head\r\nrow1\r\nrow2\r\nfoot");
    buffer.write("\u001b[2;3r");
    buffer.resize(6, 4);
    buffer.write("\u001b[4;1H\n");

    const lines = [0, 1, 2, 3].map((row) => buffer.renderLine(row));
    console.log(JSON.stringify(lines));
    expect(lines).toEqual(["row1", "row2", "foot", ""]);
  });
});
PROBE
npx vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter=verbose
rm -f packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["row1","row2","foot",""]
✓ packages/terminal-pilot/src/__probe__.test.ts > resize scroll-region retention > drops configured margins so later bottom-row scrolling moves a fixed header
```

## Observed Behavior

The stream draws a fixed header and footer, establishes rows two through three as the scrolling region with `CSI 2;3 r`, then calls `resize(6, 4)` with the existing dimensions and issues a newline from row four. The header is scrolled away and all content moves upward, which can happen only after the margin restriction has been discarded. `packages/terminal-pilot/src/terminal-buffer.ts:108` through `packages/terminal-pilot/src/terminal-buffer.ts:131` reset `_scrollTop` and `_scrollBottom` to the entire resized screen on every resize, overwriting the margins previously installed by the `CSI r` handler at `packages/terminal-pilot/src/terminal-buffer.ts:330` through `packages/terminal-pilot/src/terminal-buffer.ts:340`.

## Expected Behavior

Resizing a terminal buffer should preserve the active scrolling region when it remains valid for the new geometry, or safely clamp it if dimensions shrink. A no-op resize to the same dimensions must not change terminal margin state; the fixed header and footer should remain protected from later scrolling within the designated middle rows.

## Impact

Interactive terminal applications commonly maintain scrolling body content between persistent status bars, headers, or prompt areas and may receive resize events while running. Terminal-pilot can silently drop those margins and return snapshots where fixed UI elements disappear or shift, causing automation and visual validation to misread the application state after window-size events.
