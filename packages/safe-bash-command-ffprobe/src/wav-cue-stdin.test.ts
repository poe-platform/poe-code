import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseWav, probeWavSource, probeWavStream, wavAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/wav-cue-before-data.wav", import.meta.url));

// Native ffprobe: the last cue ends at its start on stdin, at EOF for a file.
for (const target of ["pipe:0", "-", "/input.wav"]) {
  const seekable = target === "/input.wav";
  for (const records of [[], ["-show_packets"], ["-show_frames"]]) {
    it(`preserves WAV cue end knowledge for ${target} ${records.join(" ")}`, async () => {
      const args = ["-v", "error", "-show_chapters", ...records, "-of", "json", target];
      const chapters = [{ id: 12, time_base: "1/8000", start: 2, start_time: "0.000250",
        end: seekable ? 4 : 2, end_time: seekable ? "0.000500" : "0.000250", tags: { title: "test" } }];
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.wav", bytes);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(JSON.parse(output).chapters).toEqual(chapters);
      expect(JSON.parse(evalSyncFfprobe(seekable ? undefined : bytes, args, () => bytes)!).chapters).toEqual(chapters);
    });
  }
}

for (const seekable of [false, true]) {
  it(`keeps cue ends consistent across WAV readers (seekable=${seekable})`, async () => {
    const expected = seekable ? 4 : 2;
    const options = { seekable };
    expect(parseWav(bytes, options).chapters?.[0]?.endTimeSeconds).toBe(expected / 8000);
    expect(wavAst().probe(bytes, options).chapters?.[0]?.end).toBe(expected);
    expect((await probeWavSource({ size: bytes.length, async read(offset, length) {
      return bytes.subarray(offset, offset + length);
    } }, options)).chapters?.[0]?.end).toBe(expected);
    expect((await probeWavStream((async function* () {
      for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
    })(), options)).chapters?.[0]?.end).toBe(expected);
  });
}

for (const sampleCount of [0, 4]) {
  it(`uses a declared WAV sample count of ${sampleCount} on stdin`, async () => {
    const fact = Buffer.alloc(12);
    fact.write("fact"); fact.writeUInt32LE(4, 4); fact.writeUInt32LE(sampleCount, 8);
    const input = Buffer.concat([bytes.subarray(0, 128), fact, bytes.subarray(128)]);
    input.writeUInt32LE(input.length - 8, 4);
    const expected = sampleCount || 2;
    expect(parseWav(input, { seekable: false }).chapters?.[0]?.endTimeSeconds).toBe(expected / 8000);
    expect((await probeWavStream((async function* () { yield input; })())).chapters?.[0]?.end).toBe(expected);
  });
}
