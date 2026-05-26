# Poe Agent Transcript Partial Append Silently Corrupts Log And Drops Later Output

## Summary

The Poe Agent transcript writer catches every append failure and permanently disables subsequent logging. If an append partially modifies an existing JSONL transcript before rejecting, `write()` still resolves successfully while leaving malformed replay data and silently discarding all later session output.

## Reproduction

Create a disposable Vitest probe at `packages/poe-agent/src/runtime/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createTranscriptWriter } from "./transcript.js";

describe("poe agent interrupted transcript append", () => {
  it("silently leaves malformed replay data and drops later session output", async () => {
    const logPath = "/logs/round.jsonl";
    const base = createFsFromVolume(Volume.fromJSON({
      [logPath]: '{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"prior"}}\n'
    })).promises;
    let appendAttempts = 0;
    const writer = createTranscriptWriter({
      logPath,
      fs: {
        mkdir: async (dir, options) => await base.mkdir(dir, options),
        async appendFile(filePath, contents) {
          appendAttempts += 1;
          await base.appendFile(filePath, "{", "utf8");
          throw new Error("transcript disk full");
        }
      }
    });

    await expect(writer.write({ type: "message.delta", content: "lost" })).resolves.toBeUndefined();
    await expect(writer.write({ type: "message.delta", content: "also lost" })).resolves.toBeUndefined();
    const raw = await base.readFile(logPath, "utf8");
    console.log(JSON.stringify({ appendAttempts, raw }));
    expect(appendAttempts).toBe(1);
    expect(raw.endsWith("{")).toBe(true);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-agent/src/runtime/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"appendAttempts":1,"raw":"{\"sessionUpdate\":\"agent_message_chunk\",\"content\":{\"type\":\"text\",\"text\":\"prior\"}}\n{"}
✓ packages/poe-agent/src/runtime/__probe__.test.ts > poe agent interrupted transcript append > silently leaves malformed replay data and drops later session output
```

Remove the disposable probe after validation.

## Observed Behavior

`createTranscriptWriter()` serializes mapped ACP session updates and awaits an append to the selected transcript file at `packages/poe-agent/src/runtime/transcript.ts:89` through `packages/poe-agent/src/runtime/transcript.ts:116`. Its catch block suppresses all errors and sets a persistent `disabled` flag at `packages/poe-agent/src/runtime/transcript.ts:117` through `packages/poe-agent/src/runtime/transcript.ts:119`; every later `write()` immediately returns at line 108. In the probe, the existing valid JSONL line remains followed by a partial `"{"` fragment after a failed append, both tool calls resolve without error, and the second event never reaches the filesystem because logging was disabled.

## Expected Behavior

Transcript persistence should surface unrecoverable write failures or otherwise maintain a readable prior log and clearly report that output capture stopped. A partial append must not silently corrupt replay data while making later `write()` calls appear successful.

## Impact

Transient storage failures can silently make Poe Agent transcript files unparsable and discard all subsequent messages, tool results, and usage updates. Operators may believe session logging completed because the API resolves normally, while replay, audit, debugging, and usage reconstruction are incomplete or broken.
