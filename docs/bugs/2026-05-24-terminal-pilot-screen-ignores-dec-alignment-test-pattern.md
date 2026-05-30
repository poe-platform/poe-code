---
name: "Terminal pilot screen ignores DEC alignment test pattern"
---

# Terminal pilot screen ignores DEC alignment test pattern

## Summary

`terminal-pilot` recognizes the `ESC #` line-attribute introducer but discards its next byte unconditionally, including the DEC screen alignment test command `ESC # 8` (DECALN). A terminal application requesting the alignment pattern receives no screen update instead of a viewport filled with `E` characters.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

describe("DEC screen alignment pattern", () => {
  it("ignores ESC # 8 instead of filling every cell with E", () => {
    const buffer = new TerminalBuffer(4, 2);
    buffer.write("X\u001b#8");

    const lines = [buffer.renderLine(0), buffer.renderLine(1)];
    console.log(JSON.stringify(lines));
    expect(lines).toEqual(["X", ""]);
  });
});
PROBE
npx vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter=verbose
rm -f packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["X",""]
✓ packages/terminal-pilot/src/__probe__.test.ts > DEC screen alignment pattern > ignores ESC # 8 instead of filling every cell with E
```

## Observed Behavior

The initial `X` remains unchanged and the second row stays blank after `ESC # 8`. When `TerminalBuffer` receives `ESC #`, the escape parser at `packages/terminal-pilot/src/terminal-buffer.ts:468` through `packages/terminal-pilot/src/terminal-buffer.ts:470` enters `State.EscHash`; that state at `packages/terminal-pilot/src/terminal-buffer.ts:389` through `packages/terminal-pilot/src/terminal-buffer.ts:392` simply consumes the next character and returns to normal without executing DECALN for final byte `8`.

## Expected Behavior

`ESC # 8` should replace every cell in the visible terminal display with `E`, so a four-column, two-row screen should become `EEEE` on both rows regardless of previously displayed content.

## Impact

Terminal diagnostic, compatibility, and emulator-validation tools can invoke DECALN to verify that the visible grid is addressable and rendered correctly. Terminal-pilot silently reports an unchanged display, producing false results for such validation flows and screenshots that diverge from the real terminal display for this standard command.
