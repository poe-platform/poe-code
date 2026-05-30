---
name: "Terminal pilot screen ignores CAN while parsing CSI"
---

# Terminal pilot screen ignores CAN while parsing CSI

## Summary

`terminal-pilot` does not honor the Cancel Character control (`CAN`, `0x18`) while a Control Sequence Introducer (CSI) command is in progress. Instead of aborting the incomplete CSI and returning to normal text handling, it keeps consuming later bytes as CSI parameters and a final command, visibly repositioning or suppressing subsequent application output.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

describe("cancelled CSI sequence", () => {
  it("continues parsing after CAN and repositions later visible text", () => {
    const buffer = new TerminalBuffer(20, 2);
    buffer.write("before\u001b[31\u0018afterm!");

    const lines = [buffer.renderLine(0), buffer.renderLine(1)];
    console.log(JSON.stringify(lines));
    expect(lines).toEqual(["before             f", "term!"]);
  });
});
PROBE
npx vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter=verbose
rm -f packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["before             f","term!"]
✓ packages/terminal-pilot/src/__probe__.test.ts > cancelled CSI sequence > continues parsing after CAN and repositions later visible text
```

## Observed Behavior

After `before`, the stream starts an incomplete CSI with `ESC [ 31`, sends `CAN`, and then outputs `afterm!`. The emulator does not display `after` at the current cursor position. Because `CAN` is ignored while in `State.Csi`, the following `a` is interpreted as the final-byte horizontal-position command with parameter `31`; the remaining text begins at the clamped right edge and wraps, yielding `before             f` and `term!`. `packages/terminal-pilot/src/terminal-buffer.ts:356` through `packages/terminal-pilot/src/terminal-buffer.ts:395` delegate CSI state directly to `_feedCsi()`, while `packages/terminal-pilot/src/terminal-buffer.ts:507` through `packages/terminal-pilot/src/terminal-buffer.ts:520` do not handle cancellation controls before executing a later final byte.

## Expected Behavior

Receiving `CAN` during an incomplete CSI sequence should immediately cancel that sequence and return parsing to normal display state. The subsequent printable text `afterm!` should be written directly after `before`, producing `beforeafterm!` on the first line with no cursor command accidentally executed.

## Impact

Terminal programs can use cancellation controls to recover from abandoned or interrupted escape sequences. Terminal-pilot can instead convert ordinary subsequent output into control parameters and movement commands, corrupting displayed prompts, status messages, menus, and screenshots in ways that differ materially from a conforming terminal.
