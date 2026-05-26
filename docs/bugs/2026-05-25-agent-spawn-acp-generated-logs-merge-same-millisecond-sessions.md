# Agent spawn ACP generated logs merge same-millisecond sessions

## Summary

`@poe-code/agent-spawn` automatically names ACP session logs using only the session start millisecond and normalized agent name. Two different sessions for the same agent that start within one millisecond resolve to the same JSONL path, and the log middleware opens that path in append mode, silently merging both session event streams into one artifact.

## Reproduction

Create the disposable probe `packages/agent-spawn/src/acp/middlewares/__probe__.test.ts`:

```ts
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { beforeEach, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

import { applyMiddlewares, type AcpMiddleware, type SpawnContext } from "../middleware.js";
import { spawnLog } from "./spawn-log.js";
import type { AcpEvent } from "../types.js";

beforeEach(() => vol.reset());

it("merges different same-millisecond ACP sessions into one generated log", async () => {
  const startedAt = new Date("2026-05-25T12:34:56.789Z");
  const first = createContext("thread-one", startedAt);
  const second = createContext("thread-two", startedAt);

  await applyMiddlewares([spawnLog, source("first session")], first);
  await collect(first.eventStream!);
  await applyMiddlewares([spawnLog, source("second session")], second);
  await collect(second.eventStream!);

  expect(first.logFile).toBe(second.logFile);
  const contents = await fs.readFile(first.logFile!, "utf8");
  expect(contents.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
    { event: "agent_message", text: "first session" },
    { event: "agent_message", text: "second session" }
  ]);
  expect(path.basename(first.logFile!)).toBe("20260525-123456-789-codex.jsonl");
});

function createContext(sessionId: string, startedAt: Date): SpawnContext {
  return {
    sessionId,
    agent: "codex",
    logDir: "/tmp/spawn-logs",
    startedAt,
    events: [],
    usage: { inputTokens: 0, outputTokens: 0 }
  };
}

function source(text: string): AcpMiddleware {
  return async (ctx) => {
    ctx.eventStream = (async function* () {
      yield { event: "agent_message", text } as AcpEvent;
    })();
  };
}

async function collect(iterable: AsyncIterable<AcpEvent>): Promise<void> {
  for await (const _event of iterable) {
    // Consume the stream to trigger log writes.
  }
}
```

Run:

```sh
npm exec -- vitest run packages/agent-spawn/src/acp/middlewares/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/agent-spawn/src/acp/middlewares/__probe__.test.ts > merges different same-millisecond ACP sessions into one generated log
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

When no explicit path is provided, `resolveLogFilePath()` forms the generated filename from the millisecond timestamp and normalized agent string at `packages/agent-spawn/src/acp/middlewares/spawn-log.ts:32` through `packages/agent-spawn/src/acp/middlewares/spawn-log.ts:58`; it does not incorporate `sessionId`, `threadId`, or any collision-resistant discriminator. `SpawnLogWriter.ensureOpen()` opens that generated path with append semantics at `packages/agent-spawn/src/acp/middlewares/spawn-log.ts:97` through `packages/agent-spawn/src/acp/middlewares/spawn-log.ts:110`, and `spawnLog` exposes it as each context's `logFile` at `packages/agent-spawn/src/acp/middlewares/spawn-log.ts:125` through `packages/agent-spawn/src/acp/middlewares/spawn-log.ts:147`. In the probe, contexts for `thread-one` and `thread-two` both report `/tmp/spawn-logs/20260525-123456-789-codex.jsonl`, whose contents contain both independent messages.

## Expected Behavior

Automatically generated session logs should uniquely identify each ACP session, including when multiple requests start in the same millisecond for the same agent. Separate contexts must not append into one log artifact unless the caller explicitly supplies a shared `logPath` or `logFileName`.

## Impact

Concurrent agent spawns, retries, or batch execution can make separate sessions indistinguishable in persisted logs. Auditing, replay, telemetry attribution, failure investigation, and downstream log parsers can observe interleaved or concatenated events from unrelated conversations while both runs misleadingly advertise the same `logFile` path.
