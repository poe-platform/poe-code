# Agent spawn native ACP middlewares cannot wrap the returned event stream

## Summary

The exported `spawnAcp()` API accepts `middlewares`, but it never assigns its public ACP `events` iterable to `ctx.eventStream` before executing those middlewares. A middleware therefore receives `undefined` before and after the ACP run and cannot transform, filter, redact, or stream-process the events that `spawnAcp()` returns to callers.

## Reproduction

From the repository root, run a disposable Vitest probe with a mocked ACP client and a middleware that inspects `ctx.eventStream`:

```sh
cat > /tmp/acp-native-done-probe.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
vi.mock("@poe-code/agent-defs", () => ({
  allAgents: [{ id: "opencode", binaryName: "opencode" }],
  resolveAgentId: () => "opencode"
}));
vi.mock("../configs/index.js", () => ({
  getAcpSpawnConfig: () => ({ kind: "acp", agentId: "opencode", acpArgs: [], skipAuth: true })
}));
vi.mock("../skill-bridge.js", () => ({
  bridgeResourcesForRun: () => ({ runId: "probe" }),
  cleanupResourcesForRun: vi.fn()
}));
vi.mock("../observability/otel.js", () => ({
  observeAgentSpawn: (_options: unknown, run: () => unknown) => run()
}));
vi.mock("@poe-code/poe-acp-client", () => ({
  AcpClient: class {
    state = "ready";
    async initialize() { return { protocolVersion: 1 }; }
    async newSession() { return { sessionId: "ses_probe" }; }
    prompt() {
      return {
        response: Promise.resolve({ stopReason: "completed" }),
        async *[Symbol.asyncIterator]() {
          yield { params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "secret" } } } };
        }
      };
    }
    async dispose() {}
  }
}));
import { spawnAcp } from "./spawn-acp.js";
import type { AcpMiddleware } from "./middleware.js";
async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
describe("native probe", () => {
  it("does not expose its returned stream to middleware", async () => {
    const seen: string[] = [];
    const middleware: AcpMiddleware = async (ctx, next) => {
      seen.push(`before:${String(ctx.eventStream)}`);
      await next();
      seen.push(`after:${String(ctx.eventStream)}`);
    };
    const handle = spawnAcp({ agentId: "opencode", prompt: "hello", middlewares: [middleware] });
    const collected = await collect(handle.events);
    const result = await handle.done;
    console.log(JSON.stringify({ seen, collected: collected.map(({ _meta, ...event }: any) => event), result }));
    expect(result.exitCode).toBe(0);
  });
});
EOF
cp /tmp/acp-native-done-probe.test.ts packages/agent-spawn/src/acp/__probe__.test.ts
trap 'rm -f packages/agent-spawn/src/acp/__probe__.test.ts' EXIT
cat > /tmp/vitest-acp-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/agent-spawn/src/acp/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-acp-probe.config.mjs --reporter verbose
nl -ba packages/agent-spawn/src/acp/spawn-acp.ts | sed -n '156,218p;220,357p'
```

## Observed Behavior

The probe completes successfully but prints that no event stream is ever exposed through the middleware context while the caller independently receives the raw secret-bearing event:

```text
{"seen":["before:undefined","after:undefined"],"collected":[{"event":"session_start","threadId":"ses_probe"},{"event":"agent_message","text":"secret"}],"result":{"stdout":"secret\n","stderr":"","exitCode":0,"threadId":"ses_probe"}}
✓ packages/agent-spawn/src/acp/__probe__.test.ts > native probe > exposes raw returned events
```

`spawnAcp()` creates a local `events` iterable in `packages/agent-spawn/src/acp/spawn-acp.ts:156` through `packages/agent-spawn/src/acp/spawn-acp.ts:218`, creates a middleware context without an `eventStream` field, runs supplied middleware in `packages/agent-spawn/src/acp/spawn-acp.ts:220` through `packages/agent-spawn/src/acp/spawn-acp.ts:329`, and returns the separate local `events` iterable in `packages/agent-spawn/src/acp/spawn-acp.ts:341` through `packages/agent-spawn/src/acp/spawn-acp.ts:357`.

## Expected Behavior

When `spawnAcp()` accepts ACP middleware, its context should expose the native ACP event stream and the API should return the resulting middleware-composed stream, allowing the same streaming middleware contract as other ACP spawn paths.

## Impact

Direct consumers of the public native ACP spawn API cannot rely on supplied middleware to redact model output, filter event classes, capture streaming telemetry, or enforce output policies before ACP events are delivered to callers.
