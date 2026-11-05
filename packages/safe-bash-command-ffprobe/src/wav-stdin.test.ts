import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe 9.0.1: identical PCM16 bytes have unavailable duration/size on a pipe.
for (const target of ["-", "pipe:", "pipe:0", "/dev/stdin", "/dev/fd/0", "/input.wav"]) {
  for (const extra of [[], ["-f", "wav"], ["-count_packets"]]) {
    it(`matches native WAV metadata for ${target} with ${extra.join(" ")}`, async () => {
      const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(800)] });
      const file = target === "/input.wav";
      const args = ["-v", "quiet", "-show_entries", "stream=duration,bit_rate:format=duration,size,bit_rate", "-of", "json", ...extra, "-i", target];
      const expected = file
        ? { streams: [{ duration: "0.100000", bit_rate: "128000" }], format: { duration: "0.100000", size: "1644", bit_rate: "131520" } }
        : { streams: [{ bit_rate: "128000" }], format: { bit_rate: "128000" } };
      const fs = new MemoryFileSystem();
      if (file) await fs.writeFile(target, bytes);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (!file) yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(JSON.parse(output).streams).toEqual(expected.streams);
      expect(JSON.parse(output).format).toEqual(expected.format);
      const sync = JSON.parse(evalSyncFfprobe(file ? undefined : bytes, args, () => bytes)!);
      expect(sync.streams).toEqual(expected.streams);
      expect(sync.format).toEqual(expected.format);
    });
  }
}
