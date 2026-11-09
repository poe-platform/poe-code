import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { probeWavSource, probeWavStream, wavAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/chapid3.wav", import.meta.url));
// Native ffprobe output for a one-second PCM WAV containing ID3 CHAP and nested TIT2.
const expected = [{ id: 0, time_base: "1/1000", start: 250, start_time: "0.250000",
  end: 750, end_time: "0.750000", tags: { title: "Verse" } }];

it("reads WAV ID3 chapters across resident, range and fragmented stream readers", async () => {
  expect(wavAst().probe(bytes).chapters).toEqual(expected);
  expect((await probeWavSource({ size: bytes.length, async read(offset, length) {
    return bytes.subarray(offset, offset + Math.min(length, 7));
  } })).chapters).toEqual(expected);
  expect((await probeWavStream((async function* () {
    for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
  })())).chapters).toEqual(expected);
});

for (const target of ["/input.wav", "-"]) for (const explicit of [false, true]) {
  it(`reports WAV ID3 chapters through ffprobe ${target}, explicit=${explicit}`, async () => {
    const args = ["-v", "error", ...(explicit ? ["-f", "wav"] : []), "-show_chapters", "-of", "json", target];
    const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
    let output = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(output).chapters).toEqual(expected);
    expect(JSON.parse(evalSyncFfprobe(target === "-" ? bytes : undefined, args, () => bytes)!).chapters).toEqual(expected);
  });
}
