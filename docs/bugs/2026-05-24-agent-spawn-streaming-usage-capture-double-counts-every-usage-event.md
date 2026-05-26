# Agent spawn streaming usage capture double-counts every usage event

## Summary

The exported `spawnStreaming()` producer accumulates every emitted `usage` event into its middleware context before delivery. If a direct caller uses the exported `usageCapture` middleware with `spawnStreaming()`, that middleware subsequently iterates the already-populated `ctx.events` array and accumulates the exact same usage events a second time. Captured token and cached-token totals are doubled.

## Reproduction

From the repository root, run a disposable Vitest probe that emits one streaming usage event and inspects the context after adding the exported `usageCapture` middleware:

```sh
cat > /tmp/acp-streaming-usage-double-count-probe.test.ts <<'EOF'
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
vi.mock("../configs/resolve-config.js", () => ({
  resolveConfig: () => ({
    agentId: "opencode",
    binaryName: "opencode",
    spawnConfig: {
      kind: "cli",
      agentId: "opencode",
      adapter: "opencode",
      promptFlag: "--prompt",
      defaultArgs: [],
      modes: { yolo: [] }
    }
  })
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
import { spawn as spawnChildProcess } from "node:child_process";
import { spawnStreaming } from "./spawn.js";
import { usageCapture } from "./middlewares/usage-capture.js";
async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
describe("usage capture probe", () => {
  it("counts one usage event twice", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const child = new EventEmitter() as any;
    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = stdin;
    child.kill = vi.fn();
    vi.mocked(spawnChildProcess).mockReturnValue(child);
    let observed: unknown;
    const inspect = async (ctx: any, next: any) => { await next(); observed = ctx.usage; };
    const handle = spawnStreaming({ agentId: "opencode", prompt: "hello", middlewares: [inspect, usageCapture] });
    const streamPromise = collect(handle.events);
    await vi.waitFor(() => expect(spawnChildProcess).toHaveBeenCalledTimes(1));
    stdout.write('{"type":"step_finish","sessionID":"ses_probe","part":{"tokens":{"input":2,"output":3,"cache":{"read":5,"write":0}}}}\n');
    stdout.end();
    stderr.end();
    child.emit("close", 0, null);
    await Promise.all([streamPromise, handle.done]);
    console.log(JSON.stringify(observed));
    expect(observed).toEqual({ inputTokens: 4, outputTokens: 6, cachedTokens: 10 });
  });
});
EOF
cp /tmp/acp-streaming-usage-double-count-probe.test.ts packages/agent-spawn/src/acp/__probe__.test.ts
trap 'rm -f packages/agent-spawn/src/acp/__probe__.test.ts' EXIT
cat > /tmp/vitest-acp-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/agent-spawn/src/acp/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-acp-probe.config.mjs --reporter verbose
nl -ba packages/agent-spawn/src/acp/spawn.ts | sed -n '26,57p;323,340p;398,429p'
nl -ba packages/agent-spawn/src/acp/middlewares/usage-capture.ts | sed -n '12,62p'
```

## Observed Behavior

One usage event reporting `inputTokens: 2`, `outputTokens: 3`, and `cachedTokens: 5` produces doubled captured totals:

```text
{"inputTokens":4,"outputTokens":6,"cachedTokens":10}
✓ packages/agent-spawn/src/acp/__probe__.test.ts > usage capture probe > counts one usage event twice
```

`spawnStreaming()` runs its internal `accumulateUsage()` from `pushEvent()` in `packages/agent-spawn/src/acp/spawn.ts:26` through `packages/agent-spawn/src/acp/spawn.ts:57` and `packages/agent-spawn/src/acp/spawn.ts:323` through `packages/agent-spawn/src/acp/spawn.ts:340`. After the producer has completed, supplied middleware runs on the populated context in `packages/agent-spawn/src/acp/spawn.ts:398` through `packages/agent-spawn/src/acp/spawn.ts:429`; `usageCapture` then independently accumulates every preloaded event in `packages/agent-spawn/src/acp/middlewares/usage-capture.ts:45` through `packages/agent-spawn/src/acp/middlewares/usage-capture.ts:62`.

## Expected Behavior

Combining the public `spawnStreaming()` API with its exported `usageCapture` middleware should report each emitted usage event exactly once, whether accumulation is owned by the producer or by the middleware layer.

## Impact

Direct ACP streaming integrations that use the exported capture middleware can overstate token consumption, cached-token use, and dollar-cost totals. This corrupts telemetry, budget enforcement, billing views, and any automation that stops or ranks work based on captured usage.
