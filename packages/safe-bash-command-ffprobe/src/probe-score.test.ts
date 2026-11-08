import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

// Native ffprobe -v quiet -show_entries format=format_name,probe_score -of json -i -.
// The short MP3 has five frames (25); the longer fixture has at least seven (52).
const cases = [
  { format: "wav", bytes: encodeWav({ sampleRate: 8000, channels: [new Float64Array(2000)] }), score: 99 },
  { format: "flac", bytes: readFileSync(new URL("./fixtures/unknown-duration.flac", import.meta.url)), score: 100 },
  { format: "mp3", bytes: readFileSync(new URL("./fixtures/stdin.mp3", import.meta.url)), score: 25 },
  { format: "mp3", bytes: readFileSync(new URL("../../safe-bash-command-audio/fixtures/vbr.mp3", import.meta.url)), score: 52 }
];
for (const { format, bytes, score } of cases) for (const file of [false, true]) {
  for (const selection of ["format=format_name,probe_score", "format=probe_score", "format"]) {
    it(`reports native ${format} score ${score} via ${file ? "file" : "stdin"} selecting ${selection}`, async () => {
      const filename = file ? `/input.${format}` : "-";
      const args = ["-v", "quiet", "-show_entries", selection, "-of", "json", "-i", filename];
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
      const expected = selection === "format=probe_score" ? { probe_score: score } : { format_name: format, probe_score: score };
      expect(JSON.parse(output).format).toMatchObject(expected);
      if (selection === "format=probe_score") expect(JSON.parse(output).format).toEqual(expected);
      expect(JSON.parse(evalSyncFfprobe(file ? undefined : bytes, args, () => bytes)!).format).toMatchObject(expected);
    });
  }
}
