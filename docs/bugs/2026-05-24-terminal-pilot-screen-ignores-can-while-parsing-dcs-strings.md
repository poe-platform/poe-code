# Terminal pilot screen ignores CAN while parsing DCS strings

## Summary

`terminal-pilot` does not honor the Cancel Character control (`CAN`, `0x18`) while parsing non-OSC terminal string commands such as Device Control String (DCS). Once a DCS/SOS/PM/APC sequence starts, a cancellation byte does not restore visible-text parsing, and later printable output is discarded until an unrelated string terminator arrives.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

describe("cancelled DCS string", () => {
  it("keeps swallowing visible text after CAN until a later string terminator", () => {
    const buffer = new TerminalBuffer(20, 2);
    buffer.write("before\u001bPpayload\u0018after\u009c!");

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
✓ packages/terminal-pilot/src/__probe__.test.ts > cancelled DCS string > keeps swallowing visible text after CAN until a later string terminator
```

## Observed Behavior

The stream writes `before`, begins a DCS sequence using `ESC P`, sends `CAN`, emits visible text `after`, then sends C1 ST followed by `!`. The screen omits `after` and displays only `before!`, showing that `CAN` did not cancel the DCS parser state. `packages/terminal-pilot/src/terminal-buffer.ts:378` through `packages/terminal-pilot/src/terminal-buffer.ts:385` retain `State.Str` until C1 ST, BEL, or `ESC`, while DCS, SOS, PM, and APC enter that state via `packages/terminal-pilot/src/terminal-buffer.ts:408` through `packages/terminal-pilot/src/terminal-buffer.ts:410` or `packages/terminal-pilot/src/terminal-buffer.ts:462` through `packages/terminal-pilot/src/terminal-buffer.ts:464`.

## Expected Behavior

Receiving `CAN` while a DCS/SOS/PM/APC string is in progress should immediately abort that string and resume normal display parsing. In this sequence, `after` should be visible after `before`, producing `beforeafter!` rather than disappearing until a later terminator.

## Impact

Terminal programs can cancel interrupted device-control, application-program-command, privacy-message, or start-of-string payloads before returning to ordinary visible output. Terminal-pilot can hide the visible recovery output instead, causing screen snapshots and screenshots to omit user-facing prompts, error messages, or interface content after canceled terminal protocol traffic.
