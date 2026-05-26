# Terminal pilot resize forwards negative geometry before throwing

## Summary

The public `terminal-pilot` `resize` path accepts unrestricted numeric `cols` and `rows` values. When passed negative dimensions, `TerminalSession.resize()` forwards them to the live PTY first and then fails while resizing its local terminal buffer, producing a partial side effect before reporting an error.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const ptyEvents = new EventEmitter();
const resizeCalls: Array<[number, number]> = [];
vi.mock("node-pty", () => ({
  spawn: () => ({
    pid: 42,
    write() {},
    resize(cols: number, rows: number) { resizeCalls.push([cols, rows]); },
    kill() {},
    onData(listener: (data: string) => void) { ptyEvents.on("data", listener); return { dispose() { ptyEvents.off("data", listener); } }; },
    onExit(listener: (event: { exitCode: number }) => void) { ptyEvents.on("exit", listener); return { dispose() { ptyEvents.off("exit", listener); } }; },
  }),
}));

import { TerminalSession } from "./terminal-session.js";

describe("negative terminal resize", () => {
  it("forwards negative geometry to the PTY before its screen buffer fails", async () => {
    const session = new TerminalSession({ id: "session", command: "noop" });
    let error = "";
    try {
      await session.resize(-1, -1);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    console.log(JSON.stringify({ resizeCalls, error }));
    expect(resizeCalls).toEqual([[-1, -1]]);
    expect(error.length).toBeGreaterThan(0);
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"resizeCalls":[[-1,-1]],"error":"Invalid array length"}
✓ packages/terminal-pilot/src/__probe__.test.ts > negative terminal resize > forwards negative geometry to the PTY before its screen buffer fails
```

## Observed Behavior

The `resize` command schema declares plain numeric `cols` and `rows` without positive-integer constraints in `packages/terminal-pilot/src/commands/resize.ts`. `TerminalSession.resize()` updates stored dimensions and invokes `this.pty.resize(cols, rows)` before calling `this.terminal.resize(cols, rows)` in `packages/terminal-pilot/src/terminal-session.ts:201` through `packages/terminal-pilot/src/terminal-session.ts:209`. With `-1, -1`, the PTY receives the invalid resize call, then `TerminalBuffer` attempts `Array(-1)` in `packages/terminal-pilot/src/terminal-buffer.ts:108` through `packages/terminal-pilot/src/terminal-buffer.ts:136` and throws `Invalid array length`.

## Expected Behavior

`create-session` and `resize` inputs should require finite positive integer terminal dimensions and reject invalid geometry before modifying local state or invoking the PTY. Failed validation must not issue a resize operation to a running child terminal.

## Impact

CLI, SDK, or MCP callers can send malformed dimensions that partially affect a live PTY and then fail locally, leaving the terminal driver's actual size and terminal-pilot's in-memory representation out of sync. Subsequent screen reads and interactive actions may be unreliable, and callers receive a low-level array error instead of actionable input validation.
