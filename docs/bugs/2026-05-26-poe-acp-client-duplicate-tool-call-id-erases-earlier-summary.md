# Poe ACP client duplicate tool-call ID erases earlier summary

## Summary

The exported `@poe-code/poe-acp-client` `extractToolCallSummariesFromSessionUpdateStream()` helper stores tool-call summaries in a `Map` keyed only by `toolCallId`. If a session stream contains two distinct `tool_call` start updates with the same ID, the later invocation silently replaces the earlier one, removing the first operation and its input from extracted audit/report data.

## Reproduction

Create a disposable Vitest probe at `packages/poe-acp-client/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractToolCallSummariesFromSessionUpdateStream, type SessionUpdate } from "./index.js";

describe("duplicate ACP tool call IDs", () => {
  it("silently replaces an earlier tool invocation in extracted summaries", async () => {
    const updates: SessionUpdate[] = [
      {
        sessionUpdate: "tool_call",
        toolCallId: "shared-id",
        title: "Read secrets",
        kind: "read",
        rawInput: { path: "/first" }
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "shared-id",
        title: "Delete workspace",
        kind: "edit",
        rawInput: { path: "/second" }
      }
    ];

    const summaries = await extractToolCallSummariesFromSessionUpdateStream(updates);

    expect(summaries).toEqual([{
      toolCallId: "shared-id",
      title: "Delete workspace",
      kind: "edit",
      rawInput: { path: "/second" }
    }]);
    expect(JSON.stringify(summaries)).not.toContain("Read secrets");
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
✓ packages/poe-acp-client/src/__probe__.test.ts > duplicate ACP tool call IDs > silently replaces an earlier tool invocation in extracted summaries
```

## Observed Behavior

Given two `tool_call` updates whose IDs are both `shared-id`, the extracted summary array contains only the second operation (`Delete workspace`) and no trace of the earlier `Read secrets` invocation or its input.

`packages/poe-acp-client/src/index.ts:22` through `packages/poe-acp-client/src/index.ts:27` publicly export the summary extractor. In `packages/poe-acp-client/src/stream-helpers.ts:46` through `packages/poe-acp-client/src/stream-helpers.ts:93`, the implementation creates one `Map<string, ToolCallSummary>`, and every `tool_call` update unconditionally executes `summaries.set(update.toolCallId, summary)`. The second start event with a reused ID therefore overwrites the first summary instead of being retained as a second invocation or rejected as malformed stream data.

## Expected Behavior

Summary extraction should preserve every distinct tool invocation represented in an ACP session stream, or explicitly reject duplicate start IDs as invalid data. A later tool start must not silently erase an earlier operation solely because the producer reused its identifier.

## Impact

Malformed or compromised agents can hide prior tool operations from generated run summaries and downstream audit consumers by reusing a tool-call ID. Read, edit, command, or permission-relevant activity may disappear from retained evidence even though it was present in the original session stream, weakening observability and post-run review.
