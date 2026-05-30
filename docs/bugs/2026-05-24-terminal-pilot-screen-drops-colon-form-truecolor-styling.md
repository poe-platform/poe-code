---
name: "Terminal pilot screen drops colon-form truecolor styling"
---

# Terminal pilot screen drops colon-form truecolor styling

## Summary

`terminal-pilot` drops standard colon-separated SGR truecolor sequences such as `CSI 38:2::255:0:0 m` while producing `screen().rawLines`. Because the screenshot command renders those raw lines through `terminal-png`, text displayed in an application-defined 24-bit color becomes unstyled in terminal-pilot captures.

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

describe("truecolor colon SGR", () => {
  it("drops colon-separated 24-bit foreground styling from raw snapshots", async () => {
    const session = new TerminalSession({ id: "screen", command: "noop", cols: 10, rows: 2 });
    ptyEvents.emit("data", "\u001b[38:2::255:0:0mRED");
    const screen = await session.screen();
    console.log(JSON.stringify({ lines: screen.lines, raw: screen.rawLines }));
    expect(screen.rawLines[0]).toBe("RED");
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"lines":["RED",""],"raw":["RED",""]}
✓ packages/terminal-pilot/src/__probe__.test.ts > truecolor colon SGR > drops colon-separated 24-bit foreground styling from raw snapshots
```

## Observed Behavior

The plain-text line correctly contains `RED`, but the raw styled line also contains only `RED` and omits any SGR color styling. `packages/terminal-pilot/src/terminal-buffer.ts:507` through `packages/terminal-pilot/src/terminal-buffer.ts:519` accept digits and semicolons while parsing CSI parameters but discard colon separators. The SGR handler at `packages/terminal-pilot/src/terminal-buffer.ts:578` through `packages/terminal-pilot/src/terminal-buffer.ts:619` can apply semicolon-form `38;2;r;g;b` colors only, so colon-form truecolor never reaches serialized cell styling. The screenshot command passes `screen.rawLines` to `renderTerminalPng()` in `packages/terminal-pilot/src/commands/screenshot.ts:26` through `packages/terminal-pilot/src/commands/screenshot.ts:32`.

## Expected Behavior

Raw screen snapshots should preserve valid colon-form 24-bit SGR color state equivalently to semicolon-form truecolor. This text should retain a red foreground sequence in `rawLines`, allowing screenshot rendering and styled screen consumers to reproduce the terminal display.

## Impact

Terminal programs increasingly emit ISO/modern-terminal colon-form truecolor for syntax highlighting, status indicators, selections, and prompts. Terminal-pilot screenshots and styled screen reads silently lose those visual distinctions, potentially hiding warnings or selected controls and producing captures that do not match the live terminal.
