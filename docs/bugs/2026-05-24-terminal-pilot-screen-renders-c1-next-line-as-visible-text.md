# Terminal pilot screen renders C1 next-line as visible text

## Summary

`terminal-pilot` handles the seven-bit `ESC E` next-line control but does not recognize its equivalent eight-bit C1 form, NEL (`0x85`). A valid terminal stream containing C1 NEL is inserted into the visible screen line as a character instead of moving subsequent output to the beginning of the next row.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

describe("C1 next-line control", () => {
  it("stores NEL in the displayed text instead of moving to the next line", () => {
    const buffer = new TerminalBuffer(10, 2);
    buffer.write("A\u0085B");

    const lines = [buffer.renderLine(0), buffer.renderLine(1)];
    console.log(JSON.stringify(lines));
    expect(lines).toEqual(["A\u0085B", ""]);
  });
});
PROBE
npx vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter=verbose
rm -f packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["AB",""]
✓ packages/terminal-pilot/src/__probe__.test.ts > C1 next-line control > stores NEL in the displayed text instead of moving to the next line
```

## Observed Behavior

`A`, C1 NEL, and `B` all appear on the same rendered line, with the control byte retained inside the displayed string. The normal-state parser at `packages/terminal-pilot/src/terminal-buffer.ts:397` through `packages/terminal-pilot/src/terminal-buffer.ts:448` has explicit branches for C1 CSI (`0x9b`), C1 OSC (`0x9d`), and several C1 string commands, but no branch for NEL (`0x85`), so it enters the generic printable-character branch. In contrast, the equivalent seven-bit `ESC E` form is implemented at `packages/terminal-pilot/src/terminal-buffer.ts:481` through `packages/terminal-pilot/src/terminal-buffer.ts:484`.

## Expected Behavior

C1 NEL should behave equivalently to `ESC E`: after `A\u0085B`, the first row should display `A` and the second row should display `B` at column zero, with no control byte included in visible screen output.

## Impact

Applications or protocol adapters emitting valid eight-bit terminal control forms can produce corrupted terminal-pilot screen reads and screenshots, leaking non-printing control bytes into visible strings while misplacing following text. Automation may fail to identify prompts, menu rows, or status updates that render correctly in a terminal supporting standard C1 controls.
