import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { flacAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native FFmpeg: 1s, 8kHz FLAC with CHAPTER001/002 and CHAPTER001/002NAME comments.
const bytes = readFileSync(new URL("./fixtures/chapters.flac", import.meta.url));
const expected = [
  { id: 1, time_base: "1/1000", start: 125, start_time: "0.125000", end: 625, end_time: "0.625000", tags: { title: "Intro" } },
  { id: 2, time_base: "1/1000", start: 625, start_time: "0.625000", end: 1000, end_time: "1.000000", tags: { title: "Q and A" } }
];
it("reads FLAC comment chapters across resident, range and fragmented stream readers", async () => {
  const plugin = flacAst();
  expect(plugin.probe(bytes).chapters).toEqual(expected);
  expect((await plugin.probeMetadata!({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } })).chapters).toEqual(expected);
  expect((await plugin.probeMetadataStream!((async function* () {
    for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
  })())).chapters).toEqual(expected);
});
for (const target of ["/input.flac", "-"]) it(`reports named FLAC chapters through ffprobe ${target}`, async () => {
  const args = ["-v", "error", "-show_chapters", "-of", "json", target];
  const fs = new MemoryFileSystem(); await fs.writeFile("/input.flac", bytes);
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
