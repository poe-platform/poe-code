import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAudio } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const source = readFileSync(new URL("./fixtures/comments.flac", import.meta.url));
const frames = parseAudio(source).nodes.find(node => node.type === "FRAMES")!.data;
const cases = [
  { name: "single", comments: ["ARTIST=Alice", "ROLE=Voice"], expected: ["ARTIST=Alice", "ROLE=Voice"] },
  { name: "repeated", comments: ["ARTIST=Alice", "ARTIST=Bob", "ARTIST=Chloé", "ROLE=Voice", "ROLE=Music"],
    expected: ["ARTIST=Alice;Bob;Chloé", "ROLE=Voice;Music"] },
  { name: "reversed", comments: ["ARTIST=Chloé", "ARTIST=Bob", "ARTIST=Alice", "ROLE=Music", "ROLE=Voice"],
    expected: ["ARTIST=Chloé;Bob;Alice", "ROLE=Music;Voice"] },
  { name: "mixed case", comments: ["Artist=Alice", "artist=Bob", "ARTIST=Chloé", "ROLE=Voice", "role=Music"],
    expected: ["ARTIST=Alice;Bob;Chloé", "role=Voice;Music"] },
  { name: "interleaved case", comments: ["Artist=Alice", "ROLE=Voice", "artist=Bob", "role=Music", "Artist=Chloé"],
    expected: ["Artist=Alice;Bob;Chloé", "role=Voice;Music"] }
];

for (const mode of ["sync", "async", "mapped"]) for (const { name, comments, expected } of cases) {
  it(`coalesces ${name} FLAC copy comment records (${mode})`, async () => {
    // Author the physical length-prefixed records without normalizing their names.
    const entries = comments.map(comment => {
      const value = Buffer.from(comment), length = Buffer.alloc(4);
      length.writeUInt32LE(value.length);
      return Buffer.concat([length, value]);
    });
    const prefix = Buffer.alloc(8);
    prefix.writeUInt32LE(entries.length, 4);
    const block = Buffer.concat([prefix, ...entries]);
    const header = Buffer.from([132, 0, 0, 0]);
    header.writeUIntBE(block.length, 1, 3);
    const streamInfo = Buffer.from(source.subarray(0, 42));
    streamInfo[4] = 0;
    const input = Buffer.concat([streamInfo, header, block, frames]);
    const volume = Volume.fromJSON({ "/in.flac": input });
    const args = ["-v", "error", "-y", "-i", "/in.flac", ...(mode === "mapped" ? ["-map", "0"] : []), "-c", "copy", "/out.flac"];
    if (mode === "sync") {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    } else {
      let diagnostic = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { diagnostic += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, diagnostic);
    }
    const output = parseAudio(volume.readFileSync("/out.flac") as Buffer);
    const records = output.nodes.filter(node => node.type === "VORBIS_COMMENT")
      .flatMap(node => node.fields!.comments as string[]);
    // Inspect records, not the normalized tag dictionary, which hides duplicates.
    assert.deepEqual(records.filter(record => !record.toLowerCase().startsWith("encoder=")), expected);
    assert.deepEqual(output.nodes.find(node => node.type === "FRAMES")!.data, frames);
  });
}
