---
name: "Terminal pilot screen wraps before following carriage return"
---

# Terminal pilot screen wraps before following carriage return

## Summary

`terminal-pilot` performs automatic wrapping immediately when a printable character fills the final column. Real terminal delayed-wrap behavior keeps the cursor logically at the right margin until the next printable character, allowing a following carriage return to rewrite the same row. Consequently, `abc\rX` in a three-column session is rendered on two rows instead of rewriting the first row.

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

describe("delayed autowrap", () => {
  it("writes after CR on the next row after filling the right margin", async () => {
    const session = new TerminalSession({ id: "screen", command: "noop", cols: 3, rows: 2 });
    ptyEvents.emit("data", "abc\rX");
    const screen = await session.screen();
    console.log(JSON.stringify({ lines: screen.lines, cursor: screen.cursor }));
    expect(screen.lines).toEqual(["abc", "X"]);
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"lines":["abc","X"],"cursor":{"row":1,"col":1}}
✓ packages/terminal-pilot/src/__probe__.test.ts > delayed autowrap > writes after CR on the next row after filling the right margin
```

## Observed Behavior

After the third printable character fills a three-column line, `packages/terminal-pilot/src/terminal-buffer.ts:433` through `packages/terminal-pilot/src/terminal-buffer.ts:447` immediately resets `_cursorX` to zero and calls `_newline()`. The subsequent carriage return therefore operates on row two, and `X` is displayed beneath `abc` as `['abc', 'X']`.

## Expected Behavior

Terminal auto-wrap should be pending after placing a glyph at the right margin and should take effect only if another printable character needs a new cell. A carriage return should cancel that pending wrap and return to column zero of the current row, so `abc\rX` should display as `Xbc` on the first row with an empty second row.

## Impact

Progress indicators, status lines, prompts, and interactive widgets commonly exactly fill a terminal row before emitting carriage-return rewrites. Terminal-pilot snapshots can incorrectly split those updates over extra lines, shift downstream content, and cause agents or screenshot consumers to misidentify the current terminal state.
