# Terminal pilot history NaN last limit returns entire transcript

## Summary

The public `terminal-pilot` history API accepts `Number.NaN` as its optional `last` line limit and silently expands the bounded request into the full terminal transcript. The `read-history` command exposes the same unrestricted numeric parameter, so invalid caller input can disclose all captured output rather than rejecting or safely bounding the response.

## Reproduction

Create and execute this disposable mocked-PTY Vitest probe, then remove it:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'EOF'
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

it("returns the entire transcript for a NaN last-line limit", async () => {
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
  emitData?.("first\nsecond\nthird\n");

  await expect(session.history({ last: Number.NaN })).resolves.toEqual([
    "first",
    "second",
    "third"
  ]);
});
EOF
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/terminal-pilot/src/__probe__.test.ts > returns the entire transcript for a NaN last-line limit
Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

After the session captures three output lines, `session.history({ last: Number.NaN })` resolves with all three lines. The request does not throw and is not limited to zero or any explicit safe bound.

`HistoryOptions.last` is typed as an unrestricted optional `number` at `packages/terminal-pilot/src/terminal-session.ts:31` through `packages/terminal-pilot/src/terminal-session.ts:33`. `TerminalSession.history()` computes `Math.max(0, lines.length - opts.last)` and applies the result as `lines.slice(start)` at `packages/terminal-pilot/src/terminal-session.ts:190` through `packages/terminal-pilot/src/terminal-session.ts:200`; with `last: NaN`, `start` becomes `NaN`, and `Array.prototype.slice(NaN)` starts from index `0`. The public command parameter in `packages/terminal-pilot/src/commands/read-history.ts:4` through `packages/terminal-pilot/src/commands/read-history.ts:25` likewise accepts and forwards a plain number.

## Expected Behavior

Terminal-history line limits should require finite non-negative integer values or apply an explicitly documented safe normalization. A non-finite invalid bound must not silently turn a limited transcript read into an unlimited one.

## Impact

Automation or MCP/SDK callers that compute a malformed history limit can unexpectedly receive the entire captured session transcript, including older command output, prompts, errors, or sensitive values that the caller intended to constrain to recent lines. The silent expansion also conceals the original invalid input and can increase output volume substantially.
