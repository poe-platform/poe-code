import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Fixture: ffmpeg -v error -f lavfi -i sine=frequency=440:sample_rate=8000:duration=0.2 -c:a libmp3lame -b:a 64k -f mp3 -
// Native ffprobe: identical MP3 bytes have unavailable duration/size on a pipe.
for (const target of ["-", "pipe:", "pipe:0", "/dev/stdin", "/dev/fd/0", "/input.mp3"]) {
  for (const extra of [[], ["-f", "mp3"], ["-count_packets"]]) {
    it(`matches native MP3 metadata for ${target} with ${extra.join(" ")}`, async () => {
      const bytes = new Uint8Array(readFileSync(new URL("./fixtures/stdin.mp3", import.meta.url)));
      const file = target === "/input.mp3";
      const args = ["-v", "quiet", "-show_entries", "stream=duration,bit_rate:format=duration,size,bit_rate", "-of", "json", ...extra, "-i", target];
      const expected = file
        ? { streams: [{ duration: "0.360000", bit_rate: "64000" }], format: { duration: "0.360000", size: "2924", bit_rate: "64977" } }
        : { streams: [{ bit_rate: "64000" }], format: { bit_rate: "64000" } };
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
