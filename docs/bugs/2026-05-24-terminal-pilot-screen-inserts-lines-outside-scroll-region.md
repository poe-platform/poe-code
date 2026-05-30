---
name: "Terminal pilot screen inserts lines outside scroll region"
---

# Terminal pilot screen inserts lines outside scroll region

## Summary

`terminal-pilot` applies the ANSI insert-lines command (`CSI L`) whenever it is received, even when the cursor is outside the active scrolling region. Terminals restrict line insertion to the scrolling margins; outside that region the operation should not shift fixed header or footer content.

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

describe("line insertion outside scroll region", () => {
  it("inserts a blank header row even while the cursor is outside the scrolling margins", async () => {
    const session = new TerminalSession({ id: "screen", command: "noop", cols: 8, rows: 4 });
    ptyEvents.emit("data", "head\r\nrow1\r\nrow2\r\nfoot");
    ptyEvents.emit("data", "\u001b[2;3r\u001b[1;1H\u001b[L");
    const screen = await session.screen();
    console.log(JSON.stringify(screen.lines));
    expect(screen.lines).toEqual(["", "head", "row1", "foot"]);
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["","head","row1","foot"]
✓ packages/terminal-pilot/src/__probe__.test.ts > line insertion outside scroll region > inserts a blank header row even while the cursor is outside the scrolling margins
```

## Observed Behavior

Rows two through three are configured as the scrolling region, while the cursor is explicitly positioned on row one before sending `CSI L`. The fixed `head` row is nevertheless shifted down and replaced by an empty row. `packages/terminal-pilot/src/terminal-buffer.ts:277` through `packages/terminal-pilot/src/terminal-buffer.ts:283` insert a new line at `_cursorY` and remove one at `_scrollBottom` without first checking whether `_cursorY` lies within `_scrollTop` and `_scrollBottom`.

## Expected Behavior

Insert-lines operations should affect only a cursor position within the active scrolling region. With the cursor on fixed row one and scrolling margins set to rows two through three, this command should leave `['head', 'row1', 'row2', 'foot']` unchanged.

## Impact

Terminal UIs use scroll regions to preserve stable headers and footers while updating a central list, log view, or editor pane. Terminal-pilot can shift or erase fixed interface elements when applications send otherwise valid line-editing controls, leading agents and screenshots to observe a corrupted layout and choose incorrect actions.
