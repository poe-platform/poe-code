# Poe ACP client auto-approve malformed permission options crashes handler

## Summary

The exported `@poe-code/poe-acp-client` `AcpClient` auto-approval path trusts the incoming agent `session/request_permission` payload as a typed request and calls `.find()` on `params.options` without validation. An ACP agent that sends a non-array `options` member causes the permission request handler to throw a JavaScript `TypeError` instead of returning a controlled invalid-params or cancelled response.

## Reproduction

From the repository root, create and run this disposable probe, then remove it:

```ts
import { describe, expect, it } from "vitest";
import { AcpClient } from "./index.js";

describe("malformed permission request handling", () => {
  it("throws a TypeError when auto-approval receives a non-array option list", async () => {
    let permissionHandler: ((params: unknown) => unknown) | undefined;
    const transport = {
      sendRequest: async () => ({ protocolVersion: 1 }),
      sendNotification: () => undefined,
      onRequest: (method: string, handler: (params: unknown) => unknown) => {
        if (method === "session/request_permission") permissionHandler = handler;
      },
      onNotification: () => undefined,
    } as never;

    new AcpClient({ transport, skipAuth: true, autoApprove: true });

    await expect(
      Promise.resolve(permissionHandler?.({ toolCall: {}, options: 7 }))
    ).rejects.toThrow("params.options.find is not a function");
  });
});
```

```sh
cat > packages/poe-acp-client/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { AcpClient } from "./index.js";

describe("malformed permission request handling", () => {
  it("throws a TypeError when auto-approval receives a non-array option list", async () => {
    let permissionHandler: ((params: unknown) => unknown) | undefined;
    const transport = {
      sendRequest: async () => ({ protocolVersion: 1 }),
      sendNotification: () => undefined,
      onRequest: (method: string, handler: (params: unknown) => unknown) => {
        if (method === "session/request_permission") permissionHandler = handler;
      },
      onNotification: () => undefined,
    } as never;

    new AcpClient({ transport, skipAuth: true, autoApprove: true });

    await expect(
      Promise.resolve(permissionHandler?.({ toolCall: {}, options: 7 }))
    ).rejects.toThrow("params.options.find is not a function");
  });
});
EOF
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
rm packages/poe-acp-client/src/__probe__.test.ts
```

The probe passes while asserting the unhandled validation failure:

```text
✓ packages/poe-acp-client/src/__probe__.test.ts > malformed permission request handling > throws a TypeError when auto-approval receives a non-array option list
```

## Observed Behavior

`packages/poe-acp-client/src/index.ts:1` publicly exports `AcpClient`. Its inbound permission handler is registered in `packages/poe-acp-client/src/acp-client.ts:332` through `packages/poe-acp-client/src/acp-client.ts:354`. When `autoApprove` is enabled, the handler immediately evaluates `params.options.find(...)` twice at `packages/poe-acp-client/src/acp-client.ts:343` through `packages/poe-acp-client/src/acp-client.ts:349`. Although the declared wire type requires `options: PermissionOption[]` in `packages/poe-acp-client/src/types.ts:558` through `packages/poe-acp-client/src/types.ts:565`, this incoming ACP request crosses an untrusted transport boundary and is not runtime validated before use. Passing `{ options: 7 }` therefore rejects with `TypeError: params.options.find is not a function`.

## Expected Behavior

Inbound `session/request_permission` payloads should be validated before permission policy logic runs. If `options` is not an array of valid permission options, the client should return a protocol-level invalid-params error or a deliberately safe cancellation result rather than throw from an implementation detail.

## Impact

An incompatible or malicious ACP agent can crash the client's automatic permission-decision path with one malformed permission request. This converts a safety boundary that is intended to reject or deny unauthorized actions into an uncontrolled handler exception, disrupting interactive sessions and obscuring the actual invalid request behind an internal JavaScript error.
