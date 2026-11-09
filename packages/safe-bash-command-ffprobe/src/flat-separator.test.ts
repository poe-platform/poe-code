import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";
import { probe } from "./probe.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(80)] }, {
  tags: { title: 'a.b,_c|d"e' }
});
const writers = [["flat", "."], ["flat=s=_", "_"], ["flat=sep_char=_", "_"]] as const;

for (const [writer, separator] of writers) {
  for (const explicit of [false, true]) for (const file of [false, true]) for (const packets of [false, true]) {
    it(`writes ${writer} ${packets ? "packets" : "nested metadata"} through ${explicit ? "media" : "audio"} ${file ? "file" : "stdin"}`, async () => {
      const args = [...(explicit ? ["-f", "wav"] : []), "-v", "error", "-of", writer,
        "-show_entries", packets ? "packet=size" : "stream=index,sample_rate:format_tags=title", file ? "/input.wav" : "-"];
      const fs = new MemoryFileSystem();
      if (file) await fs.writeFile("/input.wav", bytes);
      let stdout = "", stderr = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (!file) yield bytes; } },
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      const expected = packets ? `packets${separator}packet${separator}0${separator}size="160"\n`
        : `streams${separator}stream${separator}0${separator}index=0\nstreams${separator}stream${separator}0${separator}sample_rate="8000"\nformat${separator}tags${separator}title="a.b,_c|d\\"e"\n`;
      expect(result.exitCode, stderr).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toBe(expected);
      expect(evalSyncFfprobe(file ? undefined : bytes, args, () => bytes)).toBe(expected);
    });
  }

  it(`uses ${writer} in the buffered audio writer`, () => {
    expect(probe(bytes, ["-of", writer.replace("=", ":"), "-show_entries", "stream=index:format_tags=title", "input.wav"]))
      .toBe(`streams${separator}stream${separator}0${separator}index=0\nformat${separator}tags${separator}title="a.b,_c|d\\"e"\n`);
  });
}
