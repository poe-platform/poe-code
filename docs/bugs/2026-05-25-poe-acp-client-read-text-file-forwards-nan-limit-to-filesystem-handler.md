# Poe ACP client read text file forwards NaN limit to filesystem handler

## Summary

The exported `@poe-code/poe-acp-client` client validates the optional `line` parameter of incoming `fs/read_text_file` requests, but does not validate the optional numeric `limit` parameter before invoking the configured filesystem handler. An incoming request with `limit: NaN` is accepted and delivered to application code as though it were a valid ACP read range.

## Reproduction

Create a disposable Vitest probe at `packages/poe-acp-client/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "./acp-client.js";
import type { InitializeResponse, ReadTextFileRequest } from "./types.js";

describe("ACP read_text_file invalid limit", () => {
  it("does not forward NaN limits into the filesystem handler", async () => {
    const handlers = new Map<string, (params: never) => Promise<unknown>>();
    const readTextFile = vi.fn(async () => "ok");
    const transport = {
      sendRequest: vi.fn(async () => ({
        protocolVersion: 1,
        agentCapabilities: {}
      } satisfies InitializeResponse)),
      sendNotification: vi.fn(),
      onRequest: vi.fn((method: string, handler: (params: never) => Promise<unknown>) => {
        handlers.set(method, handler);
      }),
      onNotification: vi.fn()
    };
    const client = new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true } },
      fsHandler: { readTextFile }
    });
    await client.initialize();

    await handlers.get("fs/read_text_file")?.({
      sessionId: "session-1",
      path: "/workspace/file.txt",
      limit: NaN
    } as ReadTextFileRequest as never);
    console.log(String(readTextFile.mock.calls[0]?.[0]?.limit));

    expect(readTextFile).not.toHaveBeenCalled();
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-acp-client/src/__probe__.test.ts
```

The probe prints the delivered invalid value and fails:

```text
NaN
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times

1st vi.fn() call:
  { "sessionId": "session-1", "path": "/workspace/file.txt", "line": undefined, "limit": NaN }
```

## Observed Behavior

`packages/poe-acp-client/src/acp-client.ts` registers the public `fs/read_text_file` handler when file-read capability is enabled. Its request callback calls `assertAbsolutePath(params.path)` and `assertOneBasedLineNumber(params.line)`, then passes `params.limit` directly into `fsHandler.readTextFile(...)` without any runtime validation. Supplying `limit: NaN` therefore invokes application filesystem code with a non-finite range argument instead of returning ACP `invalid_params`.

## Expected Behavior

Numeric request parameters exposed by the ACP filesystem callback should be validated consistently before application handlers run. A `limit` value that is non-finite, non-integer, or negative should produce an `invalid_params` response and must not be delivered to the filesystem implementation.

## Impact

Malformed or hostile ACP agents can send invalid file-range values into host filesystem handlers that assume validated protocol input. Depending on handler implementation, this can cause incorrect truncation, excessive reads, unexpected exceptions, or silently altered tool behavior while the client reports that it accepted a valid filesystem request.
