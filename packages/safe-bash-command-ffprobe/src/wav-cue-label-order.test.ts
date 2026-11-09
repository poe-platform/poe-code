import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { probeWavSource, wavAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const labelsFirst of [false, true]) {
  it(`resolves only preceding cue IDs with labels first=${labelsFirst}`, async () => {
    const bytes = readFileSync(new URL(`./fixtures/wav-cue-order/${labelsFirst ? "labels-first" : "cues-first"}.wav`, import.meta.url));
    const chapters = [
      { id: 1, time_base: "1/8000", start: 0, start_time: "0.000000", end: 400, end_time: "0.050000" },
      { id: 2, time_base: "1/8000", start: 400, start_time: "0.050000", end: 800, end_time: "0.100000" }
    ].map((chapter, index) => ({ ...chapter, ...(!labelsFirst ? { tags: { title: ["Intro", "Verse"][index] } } : {}) }));
    const probeChapters = chapters.map(chapter => ({ ...chapter, tags: chapter.tags ?? {} }));
    expect(wavAst().probe(bytes).chapters).toEqual(probeChapters);
    expect((await probeWavSource({ size: bytes.length, async read(offset, length) {
      return bytes.subarray(offset, offset + length);
    } })).chapters).toEqual(probeChapters);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.wav", bytes);
    const args = ["-v", "error", "-show_chapters", "-of", "json", "/input.wav"];
    let output = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(output).chapters).toEqual(chapters);
    expect(JSON.parse(evalSyncFfprobe(undefined, args, () => bytes)!).chapters).toEqual(chapters);
  });
}
