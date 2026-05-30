---
name: "Terminal pilot naturally exited session keeps hidden name reservation"
---

# Terminal pilot naturally exited session keeps hidden name reservation

## Summary

`terminal-pilot` hides naturally completed terminal sessions from `listSessions()`, but its command runtime does not release their human-readable name mappings unless callers explicitly invoke `close-session`. A process that exits normally therefore leaves an invisible session name permanently unavailable for new work in the same runtime.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { createTerminalPilotRuntime } from "./commands/runtime.js";

describe("naturally exited session naming", () => {
  it("hides an exited session from listing but still blocks reusing its name", async () => {
    const first = { id: "first", command: "one", pid: 1, exitCode: null as number | null };
    const second = { id: "second", command: "two", pid: 2, exitCode: null as number | null };
    const sessions = [first, second];
    let created = 0;
    const pilot = {
      async newSession() { return sessions[created++] as never; },
      getSession(id: string) { return sessions.find((session) => session.id === id) as never; },
      deleteSession: vi.fn(),
      sessions() { return sessions.filter((session) => session.exitCode === null) as never; },
      close: vi.fn(async () => undefined),
    };
    const runtime = createTerminalPilotRuntime({ launchPilot: async () => pilot as never });

    await runtime.createSession({ session: "job", command: "one" });
    first.exitCode = 0;
    const listed = await runtime.listSessions();
    let error = "";
    try {
      await runtime.createSession({ session: "job", command: "two" });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }

    console.log(JSON.stringify({ listed: listed.map((entry) => entry.name), error, launched: created }));
    expect(listed).toEqual([]);
    expect(error).toBe('Session "job" already exists.');
    expect(created).toBe(1);
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"listed":[],"error":"Session \"job\" already exists.","launched":1}
✓ packages/terminal-pilot/src/__probe__.test.ts > naturally exited session naming > hides an exited session from listing but still blocks reusing its name
```

## Observed Behavior

`TerminalPilot.sessions()` filters completed sessions out of active listings when `exitCode !== null` in `packages/terminal-pilot/src/terminal-pilot.ts`. The command runtime's `listSessions()` mirrors only those active sessions, so an exited `job` no longer appears. However, `createSession()` in `packages/terminal-pilot/src/commands/runtime.ts` rejects whenever `nameToId` still contains the requested name, and name mappings are removed only during explicit `closeSession()` or complete runtime shutdown. Natural process exit never calls `forgetSession()`.

## Expected Behavior

When a terminal process exits and is no longer an active listed session, its public name should be released automatically, or completed sessions should remain addressable with a documented cleanup path. Creating a new session named `job` after the prior `job` exits normally should succeed without requiring users to close an already invisible session.

## Impact

Long-lived MCP or SDK runtimes accumulate unusable reserved session names as commands naturally complete. Automated flows that use stable names eventually fail with duplicate-name errors despite having no visible active session, forcing global runtime resets or unpredictable name generation to continue operating.
