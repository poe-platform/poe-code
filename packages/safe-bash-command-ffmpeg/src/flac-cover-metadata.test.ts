import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAudio, writeAudioMetadata } from "@poe-code/audio-ast";
import { flacAst } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg fixture: distinct 5×3 front and 3×6 back PNG pictures.
const input = readFileSync(new URL("./fixtures/cover-metadata.flac", import.meta.url));
const original = parseAudio(input);
const cases = [
  { name: "preserves unedited pictures", options: [], descriptions: ["Front view", "Back view"], types: [3, 4] },
  { name: "updates only the second title", options: ["-metadata:s:v:1", "title=Updated back"], descriptions: ["Front view", "Updated back"], types: [3, 4] },
  { name: "clears the first title", options: ["-metadata:s:v:0", "title="], descriptions: ["", "Back view"], types: [3, 4] },
  { name: "updates only the first picture type", options: ["-metadata:s:v:0", "comment=Leaflet page"], descriptions: ["Front view", "Back view"], types: [5, 4] },
  { name: "clears the first picture type", options: ["-metadata:s:v:0", "comment="], descriptions: ["Front view", "Back view"], types: [0, 4] },
  { name: "targets the absolute output stream index", options: ["-metadata:s:2", "comment=Leaflet page"], descriptions: ["Front view", "Back view"], types: [3, 5] },
  { name: "keeps global comments separate", options: ["-metadata", "comment=Leaflet page"], descriptions: ["Front view", "Back view"], types: [3, 4] }
];

for (const sync of [false, true]) for (const testCase of cases) {
  it(`FLAC cover metadata ${testCase.name} (${sync ? "sync" : "async"})`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.flac", sync ? writeAudioMetadata(input, {}, { pictures: original.pictures.slice(0, 1) }) : input);
    const args = ["-y", "-v", "error", "-i", "/in.flac", ...(sync ? [] : ["-map", "0"]),
      ...testCase.options, "-c", "copy", "/out.flac"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    } else {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    }
    const bytes = volume.readFileSync("/out.flac") as Buffer;
    const output = parseAudio(bytes);
    const expected = original.pictures.slice(0, sync ? 1 : 2).map((picture, index) => ({
      ...picture, description: testCase.descriptions[index], type: testCase.types[index]
    }));
    assert.deepEqual(output.pictures, expected);
    assert.deepEqual(output.nodes.find(node => node.type === "FRAMES")!.data,
      original.nodes.find(node => node.type === "FRAMES")!.data);
    assert.deepEqual(flacAst().parse(bytes).tracks[0]!.decodedAudio,
      flacAst().parse(input).tracks[0]!.decodedAudio);
  });
}
