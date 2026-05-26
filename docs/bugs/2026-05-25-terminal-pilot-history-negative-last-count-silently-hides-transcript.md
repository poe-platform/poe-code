# Terminal pilot history negative last count silently hides transcript

## Summary

`terminal-pilot` accepts negative `last` values for terminal history reads and applies them directly as an array-slicing offset. Supplying `last: -1` to a session that has output succeeds with an empty history result rather than rejecting the invalid request, so callers can be told that no transcript exists even though captured terminal output is present.

## Reproduction

Create the disposable probe `packages/terminal-pilot/src/__probe__.test.ts`:

```ts
import { beforeEach, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    accessSync: vi.fn(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }),
    chmodSync: vi.fn()
  };
});

vi.mock("node-pty", () => ({ spawn: spawnMock }));

beforeEach(() => {
  spawnMock.mockReset();
  vi.resetModules();
});

it("silently returns no history for a negative last-line count", async () => {
  let emitData: ((chunk: string) => void) | undefined;
  spawnMock.mockReturnValue({
    pid: 123,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData(listener: (chunk: string) => void) {
      emitData = listener;
      return { dispose: vi.fn() };
    },
    onExit: vi.fn(() => ({ dispose: vi.fn() }))
  });

  const { TerminalSession } = await import("./terminal-session.js");
  const session = new TerminalSession({ id: "probe", command: "node" });
  emitData?.("first\nsecond\n");

  await expect(session.history()).resolves.toEqual(["first", "second"]);
  await expect(session.history({ last: -1 })).resolves.toEqual([]);
});
```

Run:

```sh
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/terminal-pilot/src/__probe__.test.ts > silently returns no history for a negative last-line count
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

The public `HistoryOptions` accepts an unconstrained `number` at `packages/terminal-pilot/src/terminal-session.ts:31` through `packages/terminal-pilot/src/terminal-session.ts:33`. `TerminalSession.history()` calculates `Math.max(0, lines.length - opts.last)` and returns `lines.slice(start)` at `packages/terminal-pilot/src/terminal-session.ts:190` through `packages/terminal-pilot/src/terminal-session.ts:200`; for two lines and `last: -1`, the computed start is `3`, so the method resolves successfully with `[]`. The CLI/MCP/SDK `read-history` command also declares `last` as an unrestricted numeric parameter and forwards it verbatim at `packages/terminal-pilot/src/commands/read-history.ts:4` through `packages/terminal-pilot/src/commands/read-history.ts:25`.

## Expected Behavior

History line limits should reject negative or non-integral counts through the exported SDK and command schemas, or explicitly define safe normalization behavior. A request for the last negative number of lines must not succeed with an output that falsely resembles an empty terminal transcript.

## Impact

Automation and agents using `read-history` can accidentally pass a negative count from user input, arithmetic, or pagination logic and receive a silent empty transcript instead of actionable validation. This can hide prompts, command failures, or progress output and cause subsequent terminal decisions to be made from missing evidence.
