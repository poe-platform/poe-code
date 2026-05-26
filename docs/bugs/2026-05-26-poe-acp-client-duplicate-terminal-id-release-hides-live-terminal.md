# Poe ACP client duplicate terminal ID release hides live terminal

## Summary

The exported `@poe-code/poe-acp-client` `AcpClient` tracks agent-created terminal handles in a `Set<string>` per session. If the configured terminal handler returns the same terminal ID for two distinct successful `terminal/create` requests, both live terminal lifecycles collapse into one tracked entry; releasing either terminal removes the shared entry and makes the other still-live terminal inaccessible through subsequent ACP requests.

## Reproduction

From the repository root, create and run this disposable probe, then remove it:

```ts
import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "./index.js";

describe("terminal tracking with reused IDs", () => {
  it("releasing one duplicate terminal makes the other unreachable", async () => {
    const requests = new Map<string, (params: unknown) => Promise<unknown>>();
    const output = vi.fn(async () => ({ output: "still alive", truncated: false }));
    const transport = {
      sendRequest: async () => ({ protocolVersion: 1 }),
      sendNotification: () => undefined,
      onRequest: (method: string, handler: (params: unknown) => Promise<unknown>) => {
        requests.set(method, handler);
      },
      onNotification: () => undefined,
    } as never;
    new AcpClient({
      transport,
      clientCapabilities: { terminal: true },
      terminalHandler: {
        create: async () => "shared-terminal",
        output,
        waitForExit: async () => ({ exitCode: 0 }),
        kill: async () => undefined,
        release: async () => undefined,
      },
    });

    await requests.get("terminal/create")?.({ sessionId: "s", command: "first" });
    await requests.get("terminal/create")?.({ sessionId: "s", command: "second" });
    await requests.get("terminal/release")?.({ sessionId: "s", terminalId: "shared-terminal" });

    await expect(
      requests.get("terminal/output")?.({ sessionId: "s", terminalId: "shared-terminal" })
    ).rejects.toMatchObject({ message: 'Resource not found: terminal "shared-terminal"' });
    expect(output).not.toHaveBeenCalled();
  });
});
```

```sh
cat > packages/poe-acp-client/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "./index.js";

describe("terminal tracking with reused IDs", () => {
  it("releasing one duplicate terminal makes the other unreachable", async () => {
    const requests = new Map<string, (params: unknown) => Promise<unknown>>();
    const output = vi.fn(async () => ({ output: "still alive", truncated: false }));
    const transport = {
      sendRequest: async () => ({ protocolVersion: 1 }),
      sendNotification: () => undefined,
      onRequest: (method: string, handler: (params: unknown) => Promise<unknown>) => {
        requests.set(method, handler);
      },
      onNotification: () => undefined,
    } as never;
    new AcpClient({
      transport,
      clientCapabilities: { terminal: true },
      terminalHandler: {
        create: async () => "shared-terminal",
        output,
        waitForExit: async () => ({ exitCode: 0 }),
        kill: async () => undefined,
        release: async () => undefined,
      },
    });

    await requests.get("terminal/create")?.({ sessionId: "s", command: "first" });
    await requests.get("terminal/create")?.({ sessionId: "s", command: "second" });
    await requests.get("terminal/release")?.({ sessionId: "s", terminalId: "shared-terminal" });

    await expect(
      requests.get("terminal/output")?.({ sessionId: "s", terminalId: "shared-terminal" })
    ).rejects.toMatchObject({ message: 'Resource not found: terminal "shared-terminal"' });
    expect(output).not.toHaveBeenCalled();
  });
});
EOF
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
rm packages/poe-acp-client/src/__probe__.test.ts
```

The probe passes while asserting that a still-live terminal can no longer be addressed:

```text
✓ packages/poe-acp-client/src/__probe__.test.ts > terminal tracking with reused IDs > releasing one duplicate terminal makes the other unreachable
```

## Observed Behavior

`packages/poe-acp-client/src/index.ts:1` publicly exports `AcpClient`. In `packages/poe-acp-client/src/acp-client.ts:693` through `packages/poe-acp-client/src/acp-client.ts:707`, every successful `terminal/create` response is passed to `trackTerminal()`. That helper stores IDs in `Set<string>` state at `packages/poe-acp-client/src/acp-client.ts:797` through `packages/poe-acp-client/src/acp-client.ts:805`, so a second terminal returned with an already-used identifier adds no separately tracked lifecycle. The `terminal/release` handler then invokes `untrackTerminal()` after releasing one handle at `packages/poe-acp-client/src/acp-client.ts:748` through `packages/poe-acp-client/src/acp-client.ts:759`; subsequent `terminal/output` for the identical ID is rejected by `assertKnownTerminal()` at `packages/poe-acp-client/src/acp-client.ts:807` through `packages/poe-acp-client/src/acp-client.ts:813`, even though the second successful create was never released.

## Expected Behavior

The client should reject duplicate terminal IDs returned for simultaneously live creates, or track reference-counted/lifecycle-distinct handles so that releasing one terminal does not untrack another terminal that remains active under the same provider-supplied identifier.

## Impact

A terminal backend that accidentally reuses an ID, or an agent/backend integration that exposes colliding handle values, can make active terminal output, waiting, killing, and cleanup impossible after an unrelated release. The session loses control over a still-running terminal and may leak processes or suppress output despite both create calls having reported success.
