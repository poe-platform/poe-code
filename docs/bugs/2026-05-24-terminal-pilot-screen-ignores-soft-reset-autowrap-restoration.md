---
name: "Terminal pilot screen ignores soft-reset autowrap restoration"
---

# Terminal pilot screen ignores soft-reset autowrap restoration

## Summary

`terminal-pilot` ignores DEC soft terminal reset (`CSI ! p`). If an application disables auto-wrap and later sends the standard soft reset to restore default terminal modes, the emulator leaves auto-wrap disabled and continues overwriting the rightmost screen cell instead of wrapping subsequent text.

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

describe("soft terminal reset", () => {
  it("ignores DECSTR and leaves autowrap disabled", async () => {
    const session = new TerminalSession({ id: "screen", command: "noop", cols: 3, rows: 2 });
    ptyEvents.emit("data", "\u001b[?7l\u001b[!pabcd");
    const screen = await session.screen();
    console.log(JSON.stringify({ lines: screen.lines, cursor: screen.cursor }));
    expect(screen.lines).toEqual(["abd", ""]);
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"lines":["abd",""],"cursor":{"row":0,"col":2}}
✓ packages/terminal-pilot/src/__probe__.test.ts > soft terminal reset > ignores DECSTR and leaves autowrap disabled
```

## Observed Behavior

The stream first disables DEC auto-wrap with `CSI ? 7 l`, then requests a soft reset with `CSI ! p`, and prints four characters into a three-column display. Because the reset is ignored, `d` overwrites the last cell and the result is `abd` on one row. `packages/terminal-pilot/src/terminal-buffer.ts:200` through `packages/terminal-pilot/src/terminal-buffer.ts:204` update `_autoWrap` for private mode `7`, while `packages/terminal-pilot/src/terminal-buffer.ts:507` through `packages/terminal-pilot/src/terminal-buffer.ts:519` parse `!` as an intermediate marker but `_execCsi()` has no soft-reset handling for final `p`.

## Expected Behavior

DEC soft reset should return resettable terminal modes to defaults, including re-enabling automatic wrapping. Following this stream, printing beyond the right margin should proceed with wrapping behavior rather than overwriting the final cell while auto-wrap remains disabled.

## Impact

Interactive applications can temporarily disable wrap while drawing and rely on soft reset during teardown, screen transitions, or error recovery. Terminal-pilot may retain stale rendering modes across application phases, corrupting later prompt text, command output, or UI snapshots even after the application issued a standard reset operation.
