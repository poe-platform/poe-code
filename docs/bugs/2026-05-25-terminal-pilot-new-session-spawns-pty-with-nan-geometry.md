# Terminal pilot new session spawns PTY with NaN geometry

## Summary

The exported `terminal-pilot` `TerminalPilot.newSession()` SDK API accepts non-finite terminal dimensions such as `Number.NaN`. Rather than rejecting unusable geometry before any external action, it creates a live terminal session and forwards `cols: NaN` and `rows: NaN` directly to `node-pty.spawn()`.

## Reproduction

Create a disposable Vitest probe at `packages/terminal-pilot/src/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPilot } from "./terminal-pilot.js";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock("node-pty", () => ({
  spawn: spawnMock
}));

describe("terminal-pilot non-finite session geometry", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockReturnValue({
      pid: 123,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() }))
    });
  });

  it("spawns a live PTY session with NaN dimensions", async () => {
    const pilot = await TerminalPilot.launch();

    const session = await pilot.newSession({
      command: "node",
      cols: Number.NaN,
      rows: Number.NaN
    });
    const screen = await session.screen();

    expect(spawnMock).toHaveBeenCalledWith(
      "node",
      [],
      expect.objectContaining({ cols: Number.NaN, rows: Number.NaN })
    );
    expect(screen.size).toEqual({ cols: Number.NaN, rows: Number.NaN });
    expect(screen.lines).toEqual([]);
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm -f packages/terminal-pilot/src/__probe__.test.ts
```

## Observed Behavior

The SDK successfully constructs a session after forwarding non-finite geometry to the PTY factory, and its resulting screen advertises the same invalid size while containing no renderable rows:

```text
✓ packages/terminal-pilot/src/__probe__.test.ts > terminal-pilot non-finite session geometry > spawns a live PTY session with NaN dimensions
```

The passing assertions observe the effective values:

```json
{"spawn":{"cols":"NaN","rows":"NaN"},"screen":{"size":{"cols":"NaN","rows":"NaN"},"lines":[]}}
```

`TerminalPilot.newSession()` in `packages/terminal-pilot/src/terminal-pilot.ts` passes optional numeric dimensions into `TerminalSession` without checking finiteness or positivity. The constructor in `packages/terminal-pilot/src/terminal-session.ts` stores those values, creates its in-memory terminal buffer, and immediately calls `createPtyProcess()`, which forwards the unvalidated dimensions into `nodePty.spawn()`. Later `screen()` loops until `row < this.currentRows`; with `rows: NaN`, that loop never renders any screen rows while preserving the invalid reported geometry.

## Expected Behavior

Session creation should validate that `cols` and `rows`, when supplied, are finite positive integers before creating the terminal buffer or spawning a PTY. Invalid geometry should fail synchronously with an actionable input error and no process side effects.

## Impact

SDK callers, and any CLI or MCP schema path that permits equivalent numeric inputs, can launch a live external process with invalid terminal dimensions and receive a session object whose screen representation is unusable. This can leak running PTYs after a bad request, produce empty or misleading screenshots, and defer failure to downstream native behavior rather than rejecting the malformed request before execution.
