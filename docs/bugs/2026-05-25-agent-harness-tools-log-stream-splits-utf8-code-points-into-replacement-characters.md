# Agent harness log stream splits UTF-8 code points into replacement characters

## Summary

`@poe-code/agent-harness-tools` streams newly appended log bytes by decoding every unread byte suffix independently and then advancing the persisted byte offset to the current file length. If a multibyte UTF-8 character is partially written when the stream polls, the partial sequence is emitted as `�`; when its remaining byte arrives, that trailing byte is emitted as another `�` because the earlier bytes have already been committed and cannot be re-decoded together.

## Reproduction

Create the disposable probe `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { streamLogFile, type LogStreamFs } from "./log-stream.js";

describe("split UTF-8 log chunks", () => {
  it("commits an incomplete code point before its remaining byte arrives", async () => {
    const writes = [Buffer.from([0xe2, 0x82]), Buffer.from([0xe2, 0x82, 0xac])];
    const fs: LogStreamFs = {
      promises: {
        async readFile() {
          return writes.shift() ?? Buffer.from([0xe2, 0x82, 0xac]);
        }
      }
    };
    const iterator = streamLogFile({ fs }, "job-1", {})[Symbol.asyncIterator]();

    const first = await iterator.next();
    const second = await iterator.next();

    expect(first.value).toEqual({ byteOffset: 0, data: "�" });
    expect(second.value).toEqual({ byteOffset: 2, data: "�" });
    expect(first.value.data + second.value.data).not.toBe("€");
    await iterator.return?.();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > split UTF-8 log chunks > commits an incomplete code point before its remaining byte arrives
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`streamLogFile()` advances `byteOffset` to `result.nextByteOffset` before yielding each emitted chunk at `packages/agent-harness-tools/src/log-stream.ts:52` through `packages/agent-harness-tools/src/log-stream.ts:56`. `readLogChunk()` decodes the unread suffix immediately with `contents.subarray(byteOffset).toString("utf8")` and records the entire file length as consumed at `packages/agent-harness-tools/src/log-stream.ts:111` through `packages/agent-harness-tools/src/log-stream.ts:127`. In the probe, the log first contains the leading two bytes of the UTF-8 encoding of `€` and later receives its final byte; consumers observe `�` followed by `�` rather than `€`.

## Expected Behavior

Incremental log streaming should preserve incomplete trailing UTF-8 sequences until enough appended bytes are available to decode a complete code point, or should otherwise decode using streaming state so the concatenated emitted text exactly represents the appended log bytes.

## Impact

Detached job logs can permanently corrupt non-ASCII output whenever a writer flushes between bytes of a character, including international text, emoji, smart punctuation, and CLI symbols. Users attaching to jobs may read inaccurate diagnostics or prompts, and downstream agents consuming streamed output can reason from text that never existed in the original command log.
