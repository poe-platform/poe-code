# Agent spawn streaming middleware event transforms are not returned to callers

## Summary

The exported `spawnStreaming()` API accepts `middlewares`, and each middleware can replace `ctx.eventStream` to transform or filter emitted ACP events. However, `spawnStreaming()` returns the original raw event stream object created before middleware execution rather than the final `ctx.eventStream`. A middleware can therefore observe and wrap the stream internally while callers still receive unredacted or otherwise untransformed events.

## Reproduction

From the repository root, run a disposable Vitest probe that installs an ACP middleware replacing every `agent_message` payload with `redacted`, then collects the public `events` stream returned by `spawnStreaming()`:

```sh
cat > /tmp/acp-streaming-middleware-returned-stream-bypass.test.ts <<'EOF'
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

vi.mock("/Users/kjopek/Workspace/poe-code/packages/agent-spawn/src/configs/resolve-config.js", () => ({
  resolveConfig: () => ({
    agentId: "codex",
    binaryName: "node",
    spawnConfig: {
      kind: "cli",
      agentId: "codex",
      adapter: "codex",
      promptFlag: "--prompt",
      defaultArgs: [],
      modes: { yolo: [] }
    }
  })
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn as spawnChildProcess } from "node:child_process";
import { spawnStreaming } from "/Users/kjopek/Workspace/poe-code/packages/agent-spawn/src/acp/spawn.ts";
import type { AcpMiddleware } from "/Users/kjopek/Workspace/poe-code/packages/agent-spawn/src/acp/middleware.ts";

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of stream) result.push(item);
  return result;
}

describe("probe", () => {
  it("returns raw events instead of the middleware-replaced stream", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const child = new EventEmitter() as any;
    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = stdin;
    child.kill = vi.fn();
    vi.mocked(spawnChildProcess).mockReturnValue(child);

    const replaceMessages: AcpMiddleware = async (ctx, next) => {
      await next();
      const source = ctx.eventStream!;
      ctx.eventStream = (async function* () {
        for await (const event of source) {
          yield event.event === "agent_message" ? { ...event, text: "redacted" } : event;
        }
      })();
    };

    const handle = spawnStreaming({ agentId: "codex", prompt: "hello", middlewares: [replaceMessages] });
    const observedPromise = collect(handle.events);
    await vi.waitFor(() => expect(spawnChildProcess).toHaveBeenCalledTimes(1));
    stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"secret"}}\n');
    stdout.end();
    stderr.end();
    child.emit("close", 0, null);

    const [observed] = await Promise.all([observedPromise, handle.done]);
    const visible = observed.map(({ _meta: _ignored, ...event }: any) => event);
    console.log(JSON.stringify(visible));
    expect(visible).toEqual([{ event: "agent_message", text: "secret" }]);
  });
});
EOF
ln -sf /tmp/acp-streaming-middleware-returned-stream-bypass.test.ts packages/agent-spawn/src/acp/__probe__.test.ts
trap 'rm -f packages/agent-spawn/src/acp/__probe__.test.ts' EXIT
cat > /tmp/vitest-acp-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/agent-spawn/src/acp/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-acp-probe.config.mjs --reporter verbose
nl -ba packages/agent-spawn/src/acp/spawn.ts | sed -n '305,378p;398,445p'
```

## Observed Behavior

The probe passes and prints the original secret-bearing event even though the middleware replaces `ctx.eventStream` with a redacting generator:

```text
[{"event":"agent_message","text":"secret"}]
✓ packages/agent-spawn/src/acp/__probe__.test.ts > probe > returns raw events instead of the middleware-replaced stream
```

`spawnStreaming()` initializes the original queue stream in `packages/agent-spawn/src/acp/spawn.ts:305` through `packages/agent-spawn/src/acp/spawn.ts:378`, allows middlewares to replace `ctx.eventStream` in `packages/agent-spawn/src/acp/spawn.ts:398` through `packages/agent-spawn/src/acp/spawn.ts:429`, but returns the earlier `ctx.eventStream` value immediately in `packages/agent-spawn/src/acp/spawn.ts:439` through `packages/agent-spawn/src/acp/spawn.ts:445` before the asynchronous middleware chain can install its replacement.

## Expected Behavior

The public `events` iterable returned by `spawnStreaming()` should yield the final middleware-composed event stream so that documented middleware transformations, filtering, logging wrappers, and redaction wrappers are observable by the caller.

## Impact

Consumers that pass a middleware to redact secrets, suppress events, translate event forms, or enforce output policy can mistakenly assume the public event stream has been transformed while raw ACP event contents continue to reach their renderers, logs, transports, or API clients.
