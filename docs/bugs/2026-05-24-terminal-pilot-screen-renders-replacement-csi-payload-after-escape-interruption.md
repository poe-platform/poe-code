---
name: "Terminal pilot screen renders replacement CSI payload after escape interruption"
---

# Terminal pilot screen renders replacement CSI payload after escape interruption

## Summary

`terminal-pilot` mishandles an `ESC` byte received while a CSI sequence is incomplete. Rather than abandoning the stale sequence and treating `ESC [` as the start of a fresh CSI command, it completes the old state without entering escape parsing, causing the parameters and final byte of the replacement command to become visible text.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

describe("interrupted CSI with new escape", () => {
  it("terminates the stale CSI on ESC and renders the replacement sequence payload as text", () => {
    const buffer = new TerminalBuffer(20, 2);
    buffer.write("before\u001b[31\u001b[1Gafter");

    const lines = [buffer.renderLine(0), buffer.renderLine(1)];
    console.log(JSON.stringify(lines));
    expect(lines).toEqual(["before1Gafter", ""]);
  });
});
PROBE
npx vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter=verbose
rm -f packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["before1Gafter",""]
✓ packages/terminal-pilot/src/__probe__.test.ts > interrupted CSI with new escape > terminates the stale CSI on ESC and renders the replacement sequence payload as text
```

## Observed Behavior

After `before`, the stream begins an incomplete CSI (`ESC [ 31`) and immediately starts a new valid cursor-position command (`ESC [ 1 G`) before writing `after`. Instead of consuming the new cursor command, terminal-pilot displays its payload as literal `1G`, yielding `before1Gafter`. The CSI parser at `packages/terminal-pilot/src/terminal-buffer.ts:507` through `packages/terminal-pilot/src/terminal-buffer.ts:520` has no branch for `ESC`; that byte is ignored while the parser remains in `State.Csi`, the following `[` finalizes the stale CSI as an unsupported command, and subsequent `1G` bytes are then processed as normal visible input.

## Expected Behavior

An `ESC` encountered during an incomplete CSI should abort or replace the incomplete command and begin parsing the new escape sequence. In this stream, `ESC [ 1 G` should be handled as cursor positioning and must not surface the literal characters `1G` in screen output.

## Impact

Interrupted terminal output and applications recovering from incomplete styling or cursor sequences may issue a fresh control sequence to restore rendering state. Terminal-pilot can expose pieces of that recovery sequence as visible garbage, corrupting prompts, status lines, captured screenshots, and automation assertions even though a real terminal consumes the control bytes.
