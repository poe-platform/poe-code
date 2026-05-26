# Poe ACP client raw update envelope fields crash message extractor

## Summary

The exported `@poe-code/poe-acp-client` `extractMessagesFromSessionUpdateStream()` helper treats any raw `SessionUpdate` carrying extension fields `jsonrpc` and `method: "session/update"` as a wrapped notification. Because raw updates do not contain `params.update`, this valid extensible stream item crashes extraction instead of returning its message chunk.

## Reproduction

From the repository root, create and run this disposable probe, then remove it:

```ts
import { describe, expect, it } from "vitest";
import { extractMessagesFromSessionUpdateStream, type SessionUpdate } from "./index.js";

describe("session update envelope discrimination", () => {
  it("misclassifies a structurally valid raw message update with extra fields", async () => {
    const incoming = {
      sessionUpdate: "agent_message_chunk" as const,
      content: { type: "text" as const, text: "still a raw update" },
      jsonrpc: "2.0",
      method: "session/update",
    };
    const rawUpdate: SessionUpdate = incoming;

    await expect(extractMessagesFromSessionUpdateStream([rawUpdate])).rejects.toThrow(
      "Cannot read properties of undefined"
    );
  });
});
```

```sh
cat > packages/poe-acp-client/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { extractMessagesFromSessionUpdateStream, type SessionUpdate } from "./index.js";

describe("session update envelope discrimination", () => {
  it("misclassifies a structurally valid raw message update with extra fields", async () => {
    const incoming = {
      sessionUpdate: "agent_message_chunk" as const,
      content: { type: "text" as const, text: "still a raw update" },
      jsonrpc: "2.0",
      method: "session/update",
    };
    const rawUpdate: SessionUpdate = incoming;

    await expect(extractMessagesFromSessionUpdateStream([rawUpdate])).rejects.toThrow(
      "Cannot read properties of undefined"
    );
  });
});
EOF
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
rm packages/poe-acp-client/src/__probe__.test.ts
```

The probe passes while asserting that extraction rejects:

```text
✓ packages/poe-acp-client/src/__probe__.test.ts > session update envelope discrimination > misclassifies a structurally valid raw message update with extra fields
```

## Observed Behavior

`packages/poe-acp-client/src/index.ts:27` publicly exports the message extractor. As the probe demonstrates, TypeScript accepts a structurally valid `SessionUpdate` value originating from an object with additional `jsonrpc` and `method` fields; runtime data received from adapters can likewise contain additional keys. In `packages/poe-acp-client/src/stream-helpers.ts:153` through `packages/poe-acp-client/src/stream-helpers.ts:165`, `isSessionUpdateNotification()` checks only those two keys, labels the raw update a `SessionUpdateNotification`, and `toSessionUpdate()` immediately reads `entry.params.update`. Since the raw item has no `params`, `extractMessagesFromSessionUpdateStream()` crashes before it can retain the valid `agent_message_chunk`.

## Expected Behavior

Stream extraction should distinguish notification envelopes from raw `SessionUpdate` objects using the complete envelope shape, including a valid `params.update`, or otherwise prioritize an existing raw `sessionUpdate` payload. Additional extension fields on a raw update must not make extraction throw.

## Impact

SDK consumers collecting agent/user message history from ACP streams can lose the entire extraction result when a valid raw update includes protocol-shaped metadata fields supplied by an adapter, extension, or upstream source. A single colliding update turns message collection, reporting, or audit generation into an exception even though the message payload itself is otherwise consumable.
