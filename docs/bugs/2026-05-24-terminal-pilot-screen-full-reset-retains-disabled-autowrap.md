# Terminal pilot screen full reset retains disabled autowrap

## Summary

`terminal-pilot` implements the Reset to Initial State control (`ESC c`, RIS) by clearing the display and resetting several cursor/style fields, but it does not restore DEC auto-wrap to its initial enabled state. Output written after a full terminal reset can therefore continue overwriting the rightmost cell as if a previous application mode were still active.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

describe("full reset auto-wrap restoration", () => {
  it("retains disabled auto-wrap after RIS resets the display", () => {
    const buffer = new TerminalBuffer(3, 2);
    buffer.write("\u001b[?7l\u001bcabcd");

    const lines = [buffer.renderLine(0), buffer.renderLine(1)];
    console.log(JSON.stringify({ lines, cursor: buffer.displayBuffer }));
    expect(lines).toEqual(["abd", ""]);
  });
});
PROBE
npx vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter=verbose
rm -f packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"lines":["abd",""],"cursor":{"cursorX":2,"cursorY":0,"data":[[[97,"a"],[98,"b"],[100,"d"]],[null,null,null]]}}
✓ packages/terminal-pilot/src/__probe__.test.ts > full reset auto-wrap restoration > retains disabled auto-wrap after RIS resets the display
```

## Observed Behavior

The stream disables DEC auto-wrap with `CSI ? 7 l`, issues the full reset command `ESC c`, and then prints four characters into a three-column display. The displayed result is `abd` on the first row because `d` overwrites `c`, proving that auto-wrap remains disabled after reset. Private mode handling at `packages/terminal-pilot/src/terminal-buffer.ts:200` through `packages/terminal-pilot/src/terminal-buffer.ts:219` mutates `_autoWrap`, while the RIS handler at `packages/terminal-pilot/src/terminal-buffer.ts:495` through `packages/terminal-pilot/src/terminal-buffer.ts:503` resets display, cursor, margins, and style but never re-enables `_autoWrap`.

## Expected Behavior

`ESC c` should return terminal modes to their initial defaults, including enabled automatic wrapping. After reset, writing `abcd` into three columns should display `abc` on the first row and `d` on the second row rather than retaining a stale no-wrap mode from before the reset.

## Impact

Terminal programs may issue RIS during startup, teardown, session handoff, or recovery to establish a clean known state. Terminal-pilot can preserve stale mode configuration across that reset and return corrupted subsequent screens, causing agents and screenshot-based validation to misread prompts, menus, progress displays, or application recovery output.
