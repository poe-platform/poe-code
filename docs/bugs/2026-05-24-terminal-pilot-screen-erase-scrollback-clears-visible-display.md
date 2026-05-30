---
name: "Terminal pilot screen erase-scrollback clears visible display"
---

# Terminal pilot screen erase-scrollback clears visible display

## Summary

`terminal-pilot` treats `CSI 3 J` (erase saved lines / scrollback) as equivalent to `CSI 2 J` (erase the visible display). A terminal application clearing scrollback history therefore unexpectedly loses all currently displayed screen content in `screen()` snapshots.

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

describe("erase saved lines", () => {
  it("clears visible text for CSI 3 J instead of only scrollback", async () => {
    const session = new TerminalSession({ id: "screen", command: "noop", cols: 20, rows: 2 });
    ptyEvents.emit("data", "visible\u001b[3J");
    const screen = await session.screen();
    console.log(JSON.stringify(screen.lines));
    expect(screen.lines[0]).toBe("");
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
["",""]
✓ packages/terminal-pilot/src/__probe__.test.ts > erase saved lines > clears visible text for CSI 3 J instead of only scrollback
```

## Observed Behavior

After rendering `visible`, sending `CSI 3 J` makes the visible first row empty. `packages/terminal-pilot/src/terminal-buffer.ts:258` through `packages/terminal-pilot/src/terminal-buffer.ts:267` group parameter `3` together with parameter `2` and erase every displayed cell. The emulator does not model scrollback separately, but it still removes content that `CSI 3 J` should leave on the active viewport.

## Expected Behavior

`CSI 3 J` should clear saved/scrollback lines without changing the currently visible display. This stream should continue to report `visible` on the screen; if scrollback is not represented by the API, handling this sequence as a no-op for visible cells is safer than erasing the viewport.

## Impact

Shells and terminal applications may clear scrollback for privacy or screen hygiene while retaining current prompts, dialogs, or progress displays. Terminal-pilot can abruptly produce a blank snapshot after that valid control sequence, causing automation to lose the active UI and fail subsequent interactions.
