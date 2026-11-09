import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAudio } from "@poe-code/audio-ast";
import { flacAst } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg fixture: distinct 5×3 front and 3×6 back PNG pictures.
const input = readFileSync(new URL("./fixtures/cover-map.flac", import.meta.url));
const original = parseAudio(input);
const cases = [
  { name: "retains both covers", maps: ["0"], pictures: [0, 1] },
  { name: "selects the back cover", maps: ["0:a", "0:v:1"], pictures: [1] },
  { name: "reorders the covers", maps: ["0:a", "0:v:1", "0:v:0"], pictures: [1, 0] },
  { name: "excludes the front cover", maps: ["0", "-0:v:0"], pictures: [1] },
  { name: "removes both covers", maps: ["0", "-0:v"], pictures: [] }
];

for (const testCase of cases) {
  it(`FLAC stream copy ${testCase.name}`, async () => {
    const volume = Volume.fromJSON({ "/in.flac": input, "/out.flac": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.flac",
        ...testCase.maps.flatMap(map => ["-map", map]), "-c", "copy", "/out.flac"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = volume.readFileSync("/out.flac") as Buffer;
    const output = parseAudio(bytes);
    assert.deepEqual(output.pictures, testCase.pictures.map(index => original.pictures[index]));
    assert.deepEqual(output.nodes.find(node => node.type === "FRAMES")!.data,
      original.nodes.find(node => node.type === "FRAMES")!.data);
    assert.deepEqual(flacAst().parse(bytes).tracks[0]!.decodedAudio,
      flacAst().parse(input).tracks[0]!.decodedAudio);
  });
}
