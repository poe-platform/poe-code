# Harness log stream corrupts UTF-8 characters split across appended reads

## Summary

`@poe-code/agent-harness-tools` tails job log files by decoding every newly appended byte range independently with `Buffer.toString("utf8")`. If a process writes a multibyte UTF-8 character across two observable append boundaries, `streamLogFile()` emits replacement characters instead of the original log text.

## Reproduction

Add the following temporary probe as `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { streamLogFile } from "./log-stream.js";

describe("log stream UTF-8 append boundaries", () => {
  it("corrupts a code point split across appended read chunks", async () => {
    vi.useFakeTimers();
    const volume = new Volume();
    const fs = createFsFromVolume(volume);
    const env = { fs: { promises: fs.promises } };
    await fs.promises.mkdir("/tmp/poe-jobs", { recursive: true });
    const bytes = Buffer.from("🧪", "utf8");
    await fs.promises.writeFile("/tmp/poe-jobs/job-1.log", bytes.subarray(0, 2));

    try {
      const chunksPromise = takeChunks(streamLogFile(env, "job-1", {}), 2);
      await vi.advanceTimersByTimeAsync(0);
      await fs.promises.appendFile("/tmp/poe-jobs/job-1.log", bytes.subarray(2));
      await vi.advanceTimersByTimeAsync(250);
      const chunks = await chunksPromise;
      const streamed = chunks.map((chunk) => chunk.data).join("");
      console.log(JSON.stringify({ chunks, streamed, expected: "🧪" }));
      expect(streamed).toBe("���");
      expect(streamed).not.toBe("🧪");
    } finally {
      vi.useRealTimers();
    }
  });
});

async function takeChunks<T>(iterable: AsyncIterable<T>, count: number): Promise<T[]> {
  const chunks: T[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
    if (chunks.length === count) break;
  }
  return chunks;
}
```

Run the probe and then remove it:

```sh
./node_modules/.bin/vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-harness-tools/src/__probe__.test.ts
```

The reproduction passes and prints the corrupted streamed output:

```text
{"chunks":[{"byteOffset":0,"data":"�"},{"byteOffset":2,"data":"��"}],"streamed":"���","expected":"🧪"}
✓ packages/agent-harness-tools/src/__probe__.test.ts > log stream UTF-8 append boundaries > corrupts a code point split across appended read chunks
```

## Observed Behavior

`streamLogFile()` tracks `byteOffset` and emits each appended segment returned by `readLogChunk()`. `readLogChunk()` takes only the newly available bytes and immediately executes `contents.subarray(byteOffset).toString("utf8")`. When the four-byte UTF-8 encoding of `🧪` is split into a two-byte first append and a two-byte second append, the two independent decodes yield `�` and `��`, producing `���` for a log file whose complete bytes decode to `🧪`.

## Expected Behavior

Incremental log streaming should preserve valid UTF-8 log content regardless of operating-system or runtime write chunk boundaries. The stream should retain incomplete trailing byte sequences until the remaining bytes arrive, so consuming all emitted text yields `🧪` for this valid log file.

## Impact

Runtime and harness consumers receive corrupted live logs whenever command output includes non-ASCII characters split across file-tail reads, including international-language output, emoji, status glyphs, and model-generated text. This makes streamed diagnostics and agent transcripts inaccurate even though the persisted log file itself contains valid bytes.
