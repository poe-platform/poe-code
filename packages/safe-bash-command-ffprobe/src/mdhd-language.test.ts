import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { parseMp4, probeMp4, probeMp4Source } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe results for unchanged fixtures differing only in track 1's mdhd language.
for (const [name, language] of [["tagged", "eng"], ["french", "fra"], ["german", "ger"], ["packed", "eng"]] as const) {
  const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/mdhd-language-${name}.mp4`, import.meta.url));
  const expected = { streams: [{ tags: { language } }] };

  it(`decodes ${name} mdhd language through both MP4 readers`, async () => {
    expect(parseMp4(bytes).tracks[1]?.language).toBe(language);
    expect(probeMp4(bytes).streams[1]?.tags?.language).toBe(language);
    const probe = await probeMp4Source({
      size: bytes.length,
      async read(offset, length) { return bytes.subarray(offset, offset + length); }
    }, { syncSamples: () => {
      const samples = new Set<number>();
      return { add(sample) { samples.add(sample); }, has(sample) { return samples.has(sample); } };
    } });
    const streams = [];
    for await (const stream of probe.streams) streams.push(stream);
    expect(streams[1]?.tags?.language).toBe(language);
  });

  for (const route of ["file", "stdin", "readFile", "sync"] as const) {
    it(`reports ${name} mdhd language through ffprobe (${route})`, async () => {
      const args = ["-v", "error", "-select_streams", "1", "-show_entries", "stream_tags=language", "-of", "json",
        route === "stdin" ? "pipe:0" : "/input.mp4"];
      if (route === "sync") {
        expect(JSON.parse(evalSyncFfprobe(undefined, args, () => bytes)!)).toEqual(expected);
        return;
      }
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.mp4", bytes);
      if (route === "readFile") Object.defineProperties(fs, { openReadFile: { value: undefined }, readStream: { value: undefined } });
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: (async function* () { if (route === "stdin") yield bytes; })(),
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(diagnostic).toBe("");
      expect(JSON.parse(output)).toEqual(expected);
    });
  }
}
