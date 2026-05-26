# Tiny stdio MCP server exported error code mutation corrupts future protocol errors

## Summary

The public `tiny-stdio-mcp-server` API exports `JSON_RPC_ERROR_CODES` as a read-only object type, but the runtime object remains mutable and is read directly while handling later requests. A consumer that changes `INVALID_REQUEST` can make subsequent valid server error responses carry an arbitrary non-standard JSON-RPC code.

## Reproduction

Create a disposable probe at `packages/tiny-stdio-mcp-server/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createServer, JSON_RPC_ERROR_CODES } from "./index.js";

const originalInvalidRequest = JSON_RPC_ERROR_CODES.INVALID_REQUEST;

afterEach(() => {
  (JSON_RPC_ERROR_CODES as unknown as { INVALID_REQUEST: number }).INVALID_REQUEST =
    originalInvalidRequest;
});

describe("tiny-stdio exported error code mutation", () => {
  it("lets public metadata corrupt later protocol error responses", async () => {
    (JSON_RPC_ERROR_CODES as unknown as { INVALID_REQUEST: number }).INVALID_REQUEST = 999;

    const server = createServer({ name: "probe", version: "1.0.0" });
    const response = await server.handleMessage("tools/list");

    expect(response.error).toEqual({
      code: 999,
      message: "Server not initialized"
    });
    expect(response.error?.code).not.toBe(originalInvalidRequest);
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny-stdio exported error code mutation > lets public metadata corrupt later protocol error responses
```

## Observed Behavior

`JSON_RPC_ERROR_CODES` is defined as an exported object at `packages/tiny-stdio-mcp-server/src/types.ts:21` through `packages/tiny-stdio-mcp-server/src/types.ts:27` and publicly re-exported from `packages/tiny-stdio-mcp-server/src/index.ts:46`. The `as const` assertion only constrains TypeScript writes; it does not freeze the runtime object. The server imports that same live object at `packages/tiny-stdio-mcp-server/src/server.ts:18` and reads `JSON_RPC_ERROR_CODES.INVALID_REQUEST` while handling pre-initialization requests at `packages/tiny-stdio-mcp-server/src/server.ts:90` through `packages/tiny-stdio-mcp-server/src/server.ts:99`. After assigning `INVALID_REQUEST = 999`, a fresh server reports `{ code: 999, message: "Server not initialized" }` instead of the JSON-RPC standard invalid-request code `-32600`.

## Expected Behavior

Public protocol constants should not be able to rewrite the behavior of future server responses. The exported error-code table should be immutable at runtime, or request handling should read protected canonical protocol values that consumers cannot mutate.

## Impact

Any same-process integration that imports and modifies the exported constants can cause unrelated MCP server responses to violate JSON-RPC error-code semantics. Clients may misclassify failures, skip expected recovery paths, or surface misleading diagnostics because an ordinary protocol error is emitted with arbitrary caller-controlled codes.
