# Terminal pilot screen treats BEL as DCS string terminator

## Summary

`terminal-pilot` incorrectly terminates Device Control String (DCS), SOS, PM, and APC sequences when it encounters a bell character (`BEL`, `0x07`). BEL is an OSC termination form, while these other terminal string commands should remain non-visible until a String Terminator; consequently, payload bytes after BEL are exposed as visible screen content.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

describe("DCS bell termination", () => {
  it("treats BEL as the end of DCS and exposes remaining payload text", () => {
    const buffer = new TerminalBuffer(20, 2);
    buffer.write("before\u001bPsecret\u0007leak\u009c!");

    const lines = [buffer.renderLine(0), buffer.renderLine(1)];
    console.log(JSON.stringify(lines));
    expect(lines).toEqual(["beforeleak\u009c!", ""]);
  });
});
PROBE
npx vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter=verbose
rm -f packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["beforeleak!",""]
✓ packages/terminal-pilot/src/__probe__.test.ts > DCS bell termination > treats BEL as the end of DCS and exposes remaining payload text
```

## Observed Behavior

The stream writes `before`, begins a DCS sequence, includes BEL inside that command, continues with payload text `leak`, sends C1 ST, and finally prints `!`. Terminal-pilot displays the post-BEL payload and even the later C1 ST byte as text (`beforeleak!`), proving that BEL prematurely ended the DCS parser state. The generic string parser at `packages/terminal-pilot/src/terminal-buffer.ts:378` through `packages/terminal-pilot/src/terminal-buffer.ts:385` returns to normal state for either C1 ST or BEL, even though DCS/SOS/PM/APC enter that branch through `packages/terminal-pilot/src/terminal-buffer.ts:408` through `packages/terminal-pilot/src/terminal-buffer.ts:410` and `packages/terminal-pilot/src/terminal-buffer.ts:462` through `packages/terminal-pilot/src/terminal-buffer.ts:464`.

## Expected Behavior

BEL inside a DCS/SOS/PM/APC string should not terminate the string. In this sequence, both `secret` and `leak` should remain non-visible command payload until C1 ST closes the DCS; the visible screen should contain only `before!`.

## Impact

Terminal protocol payloads can include bell characters or forward data from sources that do. Terminal-pilot can prematurely render the remainder of an otherwise non-display command payload, corrupting snapshots and potentially exposing control-channel content that should never appear as visible terminal text.
