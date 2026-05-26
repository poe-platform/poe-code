# Terminal pilot screen ignores CAN while parsing OSC

## Summary

`terminal-pilot` does not honor the Cancel Character control (`CAN`, `0x18`) while parsing an Operating System Command (OSC) string. Instead of aborting the incomplete metadata command and returning to visible text processing, it continues discarding subsequent printable output until an eventual OSC terminator arrives.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

describe("cancelled OSC sequence", () => {
  it("keeps swallowing visible text after CAN until a later BEL", () => {
    const buffer = new TerminalBuffer(20, 2);
    buffer.write("before\u001b]0;title\u0018after\u0007!");

    const lines = [buffer.renderLine(0), buffer.renderLine(1)];
    console.log(JSON.stringify(lines));
    expect(lines).toEqual(["before!", ""]);
  });
});
PROBE
npx vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter=verbose
rm -f packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["before!",""]
✓ packages/terminal-pilot/src/__probe__.test.ts > cancelled OSC sequence > keeps swallowing visible text after CAN until a later BEL
```

## Observed Behavior

After rendering `before`, the stream starts an OSC title command, sends `CAN`, emits visible text `after`, then sends BEL followed by `!`. The visible screen omits `after` and contains only `before!`, showing that the parser remained in OSC state after cancellation and discarded normal text until BEL. `packages/terminal-pilot/src/terminal-buffer.ts:369` through `packages/terminal-pilot/src/terminal-buffer.ts:377` leave `State.Osc` only for BEL, C1 ST, or `ESC`; there is no cancellation branch for `CAN` after OSC is entered through `packages/terminal-pilot/src/terminal-buffer.ts:405` through `packages/terminal-pilot/src/terminal-buffer.ts:407` or `packages/terminal-pilot/src/terminal-buffer.ts:459` through `packages/terminal-pilot/src/terminal-buffer.ts:461`.

## Expected Behavior

Receiving `CAN` during an incomplete OSC sequence should abort the string command immediately and resume normal display processing. The `after` text should therefore be visible after `before`, yielding `beforeafter!` without requiring a later OSC terminator.

## Impact

Shell integrations, terminal applications, and protocol bridges can cancel partial title, hyperlink, or metadata updates after interruption or malformed input. Terminal-pilot instead hides later visible output until another terminator appears, potentially omitting prompts, user-facing error text, status output, or menu labels from screen snapshots and screenshots.
