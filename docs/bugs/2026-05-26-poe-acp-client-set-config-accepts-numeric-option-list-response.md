# Poe ACP client set config accepts numeric option-list response

## Summary

The exported `@poe-code/poe-acp-client` `AcpClient.setConfigOption()` API promises to return a `SessionConfigOption[]`, but it returns the peer's `session/set_config_option` response member without runtime validation. A malformed ACP agent can respond with `configOptions: 7`, and the client resolves that number as a successful typed option-list result.

## Reproduction

Create a disposable Vitest probe at `packages/poe-acp-client/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AcpClient } from "./index.js";

describe("malformed session set config response", () => {
  it("returns a numeric configOptions field as the typed option list", async () => {
    const transport = {
      sendRequest: async (method: string) => {
        if (method === "initialize") return { protocolVersion: 1 };
        if (method === "session/set_config_option") return { configOptions: 7 };
        throw new Error(`unexpected ${method}`);
      },
      sendNotification: async () => undefined,
      onRequest: () => undefined,
      onNotification: () => undefined
    } as never;
    const client = new AcpClient({ transport, skipAuth: true });
    await client.initialize();

    const result = await client.setConfigOption("session", "mode", "fast");

    expect(result).toBe(7);
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-acp-client/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/poe-acp-client/src/__probe__.test.ts > malformed session set config response > returns a numeric configOptions field as the typed option list
```

## Observed Behavior

After successful initialization, invoking `setConfigOption("session", "mode", "fast")` against an injected transport that returns `{ configOptions: 7 }` resolves to the number `7`. No protocol-validation error is raised, even though the exported method contract declares an array of configuration options.

`packages/poe-acp-client/src/index.ts:1` publicly exports `AcpClient`. `SessionConfigOption[]` is required in `SetSessionConfigOptionResponse` at `packages/poe-acp-client/src/types.ts:544` through `packages/poe-acp-client/src/types.ts:552`. However, `AcpClient.setConfigOption()` at `packages/poe-acp-client/src/acp-client.ts:494` through `packages/poe-acp-client/src/acp-client.ts:507` awaits the peer response and returns `response.configOptions` directly without checking that it is an array or that its members satisfy the declared option shape.

## Expected Behavior

The client should validate successful ACP response payloads before exposing them under typed SDK methods. A `session/set_config_option` response with a non-array `configOptions` member should reject as malformed protocol data rather than resolve successfully as a `SessionConfigOption[]`.

## Impact

Malformed or compromised ACP agents can feed structurally invalid session configuration data into SDK consumers that trust the declared return type. Downstream UI/configuration logic may crash, iterate incorrect values, or persist invalid state only after the client has already reported a successful configuration operation.
