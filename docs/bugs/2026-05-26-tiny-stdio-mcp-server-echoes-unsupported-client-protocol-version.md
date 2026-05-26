# Tiny stdio MCP server echoes unsupported client protocol version

## Summary

The exported `tiny-stdio-mcp-server` initialization handler claims support for any string supplied as the client's MCP `protocolVersion`. Although the implementation declares one server protocol revision, `"2025-11-25"`, an `initialize` request carrying an invented unsupported revision is answered successfully with that same invented revision, falsely completing protocol-version agreement.

## Reproduction

Create the following disposable Vitest probe at `packages/tiny-stdio-mcp-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createServer } from "./index.js";

describe("MCP protocol version negotiation", () => {
  it("claims support for an arbitrary client protocol version", async () => {
    const server = createServer({ name: "probe", version: "1" });

    const result = await server.handleMessage("initialize", {
      protocolVersion: "2099-99-99-unsupported"
    });

    expect(result).toMatchObject({
      result: {
        protocolVersion: "2099-99-99-unsupported"
      }
    });
  });
});
```

Run it and remove the probe:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts
```

## Observed Behavior

The disposable probe passes:

```text
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > MCP protocol version negotiation > claims support for an arbitrary client protocol version
```

`packages/tiny-stdio-mcp-server/src/server.ts:27` defines the server's protocol revision as `"2025-11-25"`. However, initialization reads any string-valued `params.protocolVersion` and returns it unchanged at `packages/tiny-stdio-mcp-server/src/server.ts:66` through `packages/tiny-stdio-mcp-server/src/server.ts:84`; the declared server revision is used only when the client supplies no string. In the reproduction, the server therefore responds with `protocolVersion: "2099-99-99-unsupported"` even though that value is not an implemented revision.

## Expected Behavior

MCP initialization must negotiate a protocol revision supported by the server. When a client requests an unsupported revision, this server should return a revision it actually supports, such as its declared `"2025-11-25"`, or reject the handshake rather than echoing an invented version as successfully negotiated.

## Impact

Clients can complete initialization believing the server supports protocol behavior it does not implement. A client choosing features or wire shapes associated with its requested version can then fail later during ordinary operation, with the root compatibility failure hidden behind an apparently successful handshake.
