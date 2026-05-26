# Terminal pilot screen ignores custom tab stops

## Summary

`terminal-pilot` recognizes the horizontal-tab-set control sequence (`ESC H`) but deliberately ignores it. Subsequent tab characters always jump to fixed eight-column boundaries rather than positions established by the terminal application, so aligned screen output diverges from the real terminal display.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const ptyEvents = new EventEmitter();
vi.mock("node-pty", () => ({
  spawn: () => ({
    pid: 42,
    write() {},
    resize() {},
    kill() {},
    onData(listener: (data: string) => void) { ptyEvents.on("data", listener); return { dispose() {} }; },
    onExit(listener: (event: { exitCode: number }) => void) { ptyEvents.on("exit", listener); return { dispose() {} }; },
  }),
}));

import { TerminalSession } from "./terminal-session.js";

describe("custom tab stop", () => {
  it("ignores an HTS control and tabs to the default eighth column", async () => {
    const session = new TerminalSession({ id: "screen", command: "noop", cols: 20, rows: 2 });
    ptyEvents.emit("data", "A\u001bH\r\tB");
    const screen = await session.screen();
    console.log(JSON.stringify(screen.lines));
    expect(screen.lines[0]).toBe("A       B");
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["A       B",""]
✓ packages/terminal-pilot/src/__probe__.test.ts > custom tab stop > ignores an HTS control and tabs to the default eighth column
```

## Observed Behavior

After rendering `A` at column one, the application emits `ESC H` to set a tab stop at the current cursor position, returns to column zero, and emits a horizontal tab before `B`. `screen()` places `B` at the default eighth-column stop (`A       B`) rather than at the newly defined stop. `packages/terminal-pilot/src/terminal-buffer.ts:492` through `packages/terminal-pilot/src/terminal-buffer.ts:493` explicitly discard `ESC H`, while horizontal tab handling at `packages/terminal-pilot/src/terminal-buffer.ts:422` through `packages/terminal-pilot/src/terminal-buffer.ts:424` always computes the next multiple-of-eight position.

## Expected Behavior

The terminal emulator should retain tab stops created with `HTS` and use them for later horizontal tab movement, along with supporting reset behavior when relevant. After this sequence, `B` should be placed at the custom stop immediately after `A`, producing `AB` rather than padding out to a fixed default column.

## Impact

Full-screen terminal applications and tabular interfaces may set custom tab stops to align columns, labels, and selection markers. Terminal-pilot can return shifted or misleading screen content for those UIs, causing agents to infer incorrect positions, read the wrong column values, or interact with misrepresented layouts.
