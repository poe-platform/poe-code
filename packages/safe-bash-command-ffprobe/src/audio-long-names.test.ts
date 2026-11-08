import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

// Names reported by native ffprobe for these audio fixtures.
const cases = [
  { format: "wav", bytes: encodeWav({ sampleRate: 8000, channels: [new Float64Array(2000)] }), codec: "PCM signed 16-bit little-endian", container: "WAV / WAVE (Waveform Audio)" },
  { format: "flac", bytes: readFileSync(new URL("./fixtures/unknown-duration.flac", import.meta.url)), codec: "FLAC (Free Lossless Audio Codec)", container: "raw FLAC" },
  { format: "mp3", bytes: readFileSync(new URL("./fixtures/stdin.mp3", import.meta.url)), codec: "MP3 (MPEG audio layer 3)", container: "MP2/3 (MPEG audio layer 2/3)" }
];

for (const { format, bytes, codec, container } of cases) for (const file of [false, true]) {
  for (const selected of [false, true]) {
    it(`reports ${format} long names via ${file ? "file" : "stdin"} in ${selected ? "selected" : "full"} output`, async () => {
      const filename = file ? `/input.${format}` : "-";
      const args = ["-v", "quiet", ...(selected
        ? ["-show_entries", "stream=codec_long_name:format=format_long_name"]
        : ["-show_streams", "-show_format"]), "-of", "json", "-i", filename];
      const fs = new MemoryFileSystem();
      if (file) await fs.writeFile(filename, bytes);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (!file) yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      for (const text of [output, evalSyncFfprobe(file ? undefined : bytes, args, () => bytes)!]) {
        const probe = JSON.parse(text);
        expect(probe.streams).toMatchObject([{ codec_long_name: codec }]);
        expect(probe.format).toMatchObject({ format_long_name: container });
        if (selected) {
          expect(probe.streams).toEqual([{ codec_long_name: codec }]);
          expect(probe.format).toEqual({ format_long_name: container });
        }
      }
    });
  }
}
