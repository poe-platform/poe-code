---
name: "Terminal pilot concurrent create session allows duplicate public session names"
---

# Terminal pilot concurrent create session allows duplicate public session names

## Summary

`terminal-pilot` is intended to reject duplicate human-readable session names, but `createTerminalPilotRuntime().createSession()` checks name availability before awaiting process creation and reserves the name only afterward. Two concurrent requests for the same explicit name can therefore both create live terminal sessions that are exposed under one identical public name.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { createTerminalPilotRuntime } from "./commands/runtime.js";

describe("concurrent named session creation", () => {
  it("creates two live sessions with the same public name", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const sessions = [
      { id: "first", command: "one", pid: 1 },
      { id: "second", command: "two", pid: 2 },
    ];
    let index = 0;
    const pilot = {
      async newSession() {
        const session = sessions[index++]!;
        if (session.id === "first") await firstGate;
        return session as never;
      },
      getSession(id: string) { return sessions.find((session) => session.id === id) as never; },
      deleteSession: vi.fn(),
      sessions() { return sessions as never; },
      close: vi.fn(async () => undefined),
    };
    const runtime = createTerminalPilotRuntime({ launchPilot: async () => pilot as never });

    const firstPending = runtime.createSession({ session: "shared", command: "one" });
    const second = await runtime.createSession({ session: "shared", command: "two" });
    releaseFirst();
    const first = await firstPending;
    const listed = await runtime.listSessions();
    const resolved = await runtime.resolveSession("shared");

    console.log(JSON.stringify({ created: [first.session.id, second.session.id], listed: listed.map((entry) => ({ name: entry.name, id: entry.session.id })), resolved: resolved.session.id }));
    expect(listed.map((entry) => ({ name: entry.name, id: entry.session.id }))).toEqual([
      { name: "shared", id: "first" },
      { name: "shared", id: "second" },
    ]);
    expect(resolved.session.id).toBe("first");
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"created":["first","second"],"listed":[{"name":"shared","id":"first"},{"name":"shared","id":"second"}],"resolved":"first"}
✓ packages/terminal-pilot/src/__probe__.test.ts > concurrent named session creation > creates two live sessions with the same public name
```

## Observed Behavior

The existing command behavior rejects a duplicate session name when a previous session is already registered, as covered in `packages/terminal-pilot/src/commands/commands.test.ts`. However, `createSession()` in `packages/terminal-pilot/src/commands/runtime.ts` checks `nameToId.has(requestedName)` before awaiting `pilot.newSession(...)`, and only calls `rememberSession(...)` after that asynchronous launch finishes. While the first launch is pending, a second request sees the same name as free and creates another session. When the first completes after the second, both session IDs remain associated with `shared` in `idToName`, while `nameToId` resolves that public name only to the last completion.

## Expected Behavior

Starting a session with an explicit public name should reserve that name atomically before an asynchronous launch begins, or otherwise serialize duplicate name creation. A concurrent second request for `shared` should reject with the existing duplicate-name error rather than launch another unaddressable or ambiguously named terminal process.

## Impact

MCP, SDK, or CLI callers that issue overlapping session creation requests can unexpectedly launch multiple interactive processes under one name. Listing presents duplicate identifiers while commands targeting the name operate on only one session, making the other difficult to control or close and potentially leaking terminal processes and resources.
