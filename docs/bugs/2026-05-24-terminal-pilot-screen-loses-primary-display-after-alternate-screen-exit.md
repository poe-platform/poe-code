# Terminal pilot screen loses primary display after alternate-screen exit

## Summary

`terminal-pilot` implements the common `CSI ? 1049 h/l` alternate-screen control sequence by clearing its display buffer both when entering and when leaving the alternate screen. It does not preserve and restore the primary screen, so terminal applications that briefly switch screens permanently erase the visible content returned by `screen()` after they exit.

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

describe("terminal alternate screen", () => {
  it("loses the primary display contents after leaving alternate screen", async () => {
    const session = new TerminalSession({ id: "screen", command: "noop", cols: 20, rows: 2 });
    ptyEvents.emit("data", "primary");
    ptyEvents.emit("data", "\u001b[?1049halt");
    const during = await session.screen();
    ptyEvents.emit("data", "\u001b[?1049l");
    const after = await session.screen();
    console.log(JSON.stringify({ during: during.lines, after: after.lines }));
    expect(during.lines[0]).toBe("alt");
    expect(after.lines[0]).toBe("");
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"during":["alt",""],"after":["",""]}
✓ packages/terminal-pilot/src/__probe__.test.ts > terminal alternate screen > loses the primary display contents after leaving alternate screen
```

## Observed Behavior

After writing `primary`, entering alternate-screen mode displays the alternate content `alt` as expected. After sending `CSI ? 1049 l`, `screen()` returns an empty display instead of restoring `primary`. In `packages/terminal-pilot/src/terminal-buffer.ts`, the private-mode `1049` handling creates a brand-new blank screen, resets cursor coordinates, and resets style for both the `h` and `l` branches; it never saves the primary display when entering or restores it when leaving.

## Expected Behavior

Entering alternate-screen mode should preserve the existing primary display and cursor state, while leaving it should restore that original screen. A caller inspecting the session after a full-screen program exits should see the shell or UI content that was present before the temporary alternate display.

## Impact

Many interactive terminal programs use alternate-screen mode for menus, pagers, editors, dashboards, and authentication prompts. Automation reading `terminal-pilot` screens after those programs return can observe a blank or incomplete terminal instead of the restored primary state, causing lost context, incorrect UI interpretation, and failed follow-up interactions.
