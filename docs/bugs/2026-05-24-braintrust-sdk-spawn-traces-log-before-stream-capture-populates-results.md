# Braintrust SDK spawn traces log before stream capture populates results

## Summary

The SDK assembles its streaming middleware chain as `sessionCapture`, `usageCapture`, `spawnLog`, then Braintrust integration middleware. Each built-in capture middleware installs a lazy wrapper around `ctx.eventStream` only after inner middleware returns. Braintrust logs its trace in its inner `finally` block before those wrappers are consumed, so the trace sees no streamed events, empty model output, and zero token usage even when later event consumption records successful output and usage.

## Reproduction

From the repository root, run a disposable Vitest probe that applies the same ordering with a stream containing a session start, message, and usage event:

```sh
cat > /tmp/braintrust-spawn-middleware-order-probe.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
const captured = vi.hoisted(() => ({ logs: [] as unknown[] }));
vi.mock("braintrust", () => ({
  currentSpan: () => ({
    startSpan: () => ({
      log: (event: unknown) => captured.logs.push(event),
      end: () => {}
    })
  })
}));
import { applyMiddlewares } from "../../agent-spawn/src/acp/middleware.js";
import { sessionCapture } from "../../agent-spawn/src/acp/middlewares/session-capture.js";
import { usageCapture } from "../../agent-spawn/src/acp/middlewares/usage-capture.js";
import { createSpawnMiddleware } from "./adapters/spawn.js";
async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
describe("SDK middleware order", () => {
  it("emits Braintrust trace before outer captures consume events", async () => {
    const ctx: any = {
      sessionId: "unknown",
      agent: "codex",
      prompt: "fix",
      model: "gpt",
      events: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      eventStream: (async function* () {
        yield { event: "session_start", threadId: "thread-1" };
        yield { event: "agent_message", text: "done" };
        yield { event: "usage", inputTokens: 2, outputTokens: 3 };
      })()
    };
    const client: any = { recordError: vi.fn() };
    await applyMiddlewares([sessionCapture, usageCapture, createSpawnMiddleware(client)], ctx);
    console.log(`logged_before_consume=${JSON.stringify(captured.logs)}`);
    await collect(ctx.eventStream);
    console.log(`context_after_consume=${JSON.stringify({ events: ctx.events, usage: ctx.usage, sessionResult: ctx.sessionResult })}`);
    expect(captured.logs[0]).toMatchObject({
      output: "",
      metrics: { prompt_tokens: 0, completion_tokens: 0, tokens: 0 }
    });
    expect(ctx.sessionResult.output).toBe("done");
    expect(ctx.usage).toEqual({ inputTokens: 2, outputTokens: 3 });
  });
});
EOF
cp /tmp/braintrust-spawn-middleware-order-probe.test.ts packages/braintrust/src/__probe__.test.ts
trap 'rm -f packages/braintrust/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-braintrust-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/braintrust/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-braintrust-probe.config.mjs --reporter verbose
nl -ba src/sdk/spawn.ts | sed -n '128,136p;201,221p;268,289p'
nl -ba packages/braintrust/src/adapters/spawn.ts | sed -n '10,31p'
nl -ba packages/agent-spawn/src/acp/middlewares/session-capture.ts | sed -n '96,119p'
nl -ba packages/agent-spawn/src/acp/middlewares/usage-capture.ts | sed -n '45,62p'
```

## Observed Behavior

Braintrust records an empty/zero trace before the same context is subsequently populated by consuming the wrapped stream:

```text
logged_before_consume=[{"input":{"prompt":"fix"},"output":"","metadata":{"sessionId":"unknown"},"metrics":{"prompt_tokens":0,"completion_tokens":0,"tokens":0}}]
context_after_consume={"events":[{"event":"session_start","threadId":"thread-1"},{"event":"agent_message","text":"done"},{"event":"usage","inputTokens":2,"outputTokens":3}],"usage":{"inputTokens":2,"outputTokens":3},"sessionResult":{"output":"done","messages":["done"],"toolCalls":[]}}
```

The SDK orders built-in captures before the integration middleware in `src/sdk/spawn.ts:128` through `src/sdk/spawn.ts:136`, then applies that chain before returning the stream in `src/sdk/spawn.ts:201` through `src/sdk/spawn.ts:221` and `src/sdk/spawn.ts:268` through `src/sdk/spawn.ts:289`. `sessionCapture` and `usageCapture` create lazy event-stream wrappers only after `await next()` in `packages/agent-spawn/src/acp/middlewares/session-capture.ts:96` through `packages/agent-spawn/src/acp/middlewares/session-capture.ts:119` and `packages/agent-spawn/src/acp/middlewares/usage-capture.ts:45` through `packages/agent-spawn/src/acp/middlewares/usage-capture.ts:62`. Braintrust emits its trace immediately in its `finally` block in `packages/braintrust/src/adapters/spawn.ts:10` through `packages/braintrust/src/adapters/spawn.ts:31`, before callers iterate those wrappers.

## Expected Behavior

Braintrust spawn traces should be emitted only after the event stream has been consumed or otherwise after session output, tool events, thread identifiers, and usage totals are present in the context.

## Impact

SDK runs with Braintrust enabled can log apparently empty successful traces: missing final responses, missing thread identifiers, missing tool events, and zero usage. Telemetry-based debugging, cost analysis, and run evaluation become materially inaccurate for streamed agent executions.
