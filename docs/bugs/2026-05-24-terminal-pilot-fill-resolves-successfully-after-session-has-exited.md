# Terminal pilot fill resolves successfully after session has exited

## Summary

The public `terminal-pilot` `fill` command resolves normally after its target terminal process has already exited, even though `TerminalSession.send()` silently drops the requested input. Callers receive no indication that their interaction never reached a live session.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
const ptyEvents = new EventEmitter();
const writes: string[] = [];
vi.mock("node-pty", () => ({ spawn: () => ({ pid: 42, write(data: string) { writes.push(data); }, resize() {}, kill() {}, onData(listener: (data: string) => void) { ptyEvents.on("data", listener); return { dispose() {} }; }, onExit(listener: (event: { exitCode: number }) => void) { ptyEvents.on("exit", listener); return { dispose() {} }; } }) }));
import { TerminalSession } from "./terminal-session.js";
import { fill } from "./commands/fill.js";

describe("fill after terminal exit", () => {
  it("resolves normally after the exited session discards all input", async () => {
    const session = new TerminalSession({ id: "session", command: "noop" });
    ptyEvents.emit("exit", { exitCode: 0 });
    const runtime = { resolveSession: async () => ({ name: "s", session }) };
    const result = await fill.handler({ params: { text: "approve\n" }, terminalPilotRuntime: runtime } as never);
    console.log(JSON.stringify({ completed: result === undefined, exitCode: session.exitCode, writes }));
    expect(result).toBeUndefined();
    expect(writes).toEqual([]);
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"completed":true,"exitCode":0,"writes":[]}
✓ packages/terminal-pilot/src/__probe__.test.ts > fill after terminal exit > resolves normally after the exited session discards all input
```

## Observed Behavior

`fill` resolves the named session, awaits `namedSession.session.fill(params.text)`, and returns normally in `packages/terminal-pilot/src/commands/fill.ts`. `TerminalSession.fill()` delegates to `send()`, but `send()` in `packages/terminal-pilot/src/terminal-session.ts:124` through `packages/terminal-pilot/src/terminal-session.ts:130` immediately returns without writing when `exitCode !== null`. Consequently an exited session accepts the command operation at the API level while emitting no PTY input at all.

## Expected Behavior

Input operations such as `fill`, `type`, and `press-key` should reject clearly when the target session is already exited or otherwise cannot accept input. A successful command completion should mean the requested interaction was delivered to a live terminal session.

## Impact

Interactive automation can believe it answered a prompt or issued a command when the process has already completed or crashed. Follow-up waits then fail or time out with no direct explanation that input was discarded, making terminal workflows unreliable and obscuring race conditions around process exit.
