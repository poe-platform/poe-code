# Tiny stdio MCP server connect resolves before pending tool responses complete

## Summary

`tiny-stdio-mcp-server` resolves its public `connect()` promise as soon as the input stream closes, even when a request already read from that stream is still executing asynchronously. A caller that treats `await server.connect(transport)` as completion can tear down the writable transport or exit while accepted tool responses are still pending and would otherwise be written later.

## Reproduction

From the repository root, run a disposable Vitest probe that sends one slow tool call, immediately ends input, and observes output both when `connect()` resolves and after the handler finishes:

```sh
cat > /tmp/tiny-stdio-mcp-connect-resolves-before-pending-response-probe.test.ts <<'PROBE'
import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createServer, defineSchema } from "./index.js";

describe("tiny stdio MCP connection close with pending request", () => {
  it("resolves connect before an already accepted async tool response is written", async () => {
    const output: string[] = [];
    const readable = new Readable({ read() {} });
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        output.push(chunk.toString());
        callback();
      },
    });
    const server = createServer({ name: "probe", version: "1" }).tool("slow", "Slow", defineSchema({}), async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return "finished";
    });
    await server.handleMessage("initialize", {});
    const connection = server.connect({ readable, writable });
    readable.push('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"slow","arguments":{}}}\n');
    readable.push(null);
    await connection;
    const atResolve = [...output];
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.log(JSON.stringify({ atResolve, afterDelay: output }));
    expect(atResolve).toEqual([]);
    expect(output).toEqual(['{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"finished"}]}}\n']);
  });
});
PROBE
cp /tmp/tiny-stdio-mcp-connect-resolves-before-pending-response-probe.test.ts packages/tiny-stdio-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

At the moment `connect()` resolves, there is no response output. The response is written only later, after the public connection lifecycle has already reported completion:

```text
{"atResolve":[],"afterDelay":["{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"finished\"}]}}\n"]}
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny stdio MCP connection close with pending request > resolves connect before an already accepted async tool response is written
```

`packages/tiny-stdio-mcp-server/src/server.ts:265` through `packages/tiny-stdio-mcp-server/src/server.ts:267` invoke asynchronous `processLine()` calls from the line event without awaiting or tracking them. `packages/tiny-stdio-mcp-server/src/server.ts:269` through `packages/tiny-stdio-mcp-server/src/server.ts:272` then resolve `connect()` immediately on input close, regardless of in-flight message processing.

## Expected Behavior

Once the transport has accepted a complete request line, `connect()` should not report completion until all accepted requests have completed response delivery, or it should explicitly cancel them and surface that responses were abandoned. Closing input alone must not race accepted output work.

## Impact

Servers that shut down, close stdout pipes, or release surrounding resources after `connect()` resolves can truncate legitimate in-flight tool results. Clients may receive no response for requests the server already accepted, producing hangs, retries, or lost side effects during normal connection shutdown.
