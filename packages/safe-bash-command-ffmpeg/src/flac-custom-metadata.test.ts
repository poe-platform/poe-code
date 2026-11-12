import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { flacAst } from "@poe-code/mp4-ast";
import { parseAudio } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const source = readFileSync(new URL("./fixtures/comments.flac", import.meta.url));
const frames = parseAudio(source).nodes.find(node => node.type === "FRAMES")!.data;
const cases = [
  { name: "custom addition", comments: ["title=Blue"], metadata: ["SESSION=take1"], expected: ["SESSION=take1", "title=Blue"] },
  { name: "custom replacement", comments: ["SESSION=take1"], metadata: ["SESSION=take2"], expected: ["SESSION=take2"] },
  { name: "custom deletion", comments: ["SESSION=take1"], metadata: ["SESSION="], expected: [] },
  { name: "mixed-case replacement", comments: ["SESSION=take1", "ROLE=Voice"], metadata: ["Session=take2"], expected: ["Session=take2", "ROLE=Voice"] },
  { name: "mixed-case deletion", comments: ["Session=take1", "ROLE=Voice"], metadata: ["session="], expected: ["ROLE=Voice"] },
  { name: "repeated replacement", comments: ["SESSION=take1", "session=take2"], metadata: ["SESSION=take3", "Session=take4"], expected: ["Session=take4"] },
  { name: "title replacement", comments: ["title=Blue", "SESSION=take1"], metadata: ["title=Orange"], expected: ["title=Orange", "SESSION=take1"] }
];

for (const mode of ["sync", "async", "mapped", "pipe"]) for (const { name, comments, expected, metadata } of cases) {
  it(`writes ${name} FLAC copy comment records (${mode})`, async () => {
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
    const args = ["-v", "error", "-y", "-i", "/in.flac", ...(mode === "mapped" ? ["-map", "0"] : []), "-c", "copy", ...metadata.flatMap(value => ["-metadata", value]), "-f", "flac", mode === "pipe" ? "pipe:1" : "/out.flac"];
    const chunks: Uint8Array[] = [];
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
        stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { diagnostic += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, diagnostic);
    }
    const bytes = mode === "pipe" ? Buffer.concat(chunks) : volume.readFileSync("/out.flac") as Buffer;
    const output = parseAudio(bytes);
    const records = output.nodes.filter(node => node.type === "VORBIS_COMMENT")
      .flatMap(node => node.fields!.comments as string[]);
    // Inspect records, not the normalized tag dictionary, which hides duplicates.
    assert.deepEqual(records.filter(record => !record.toLowerCase().startsWith("encoder=")).sort(), [...expected].sort());
    const tags = flacAst().probe(bytes).format.tags!;
    assert.deepEqual(Object.fromEntries(Object.entries(tags).filter(([key]) => key.toLowerCase() !== "encoder")),
      Object.fromEntries(expected.map(record => { const split = record.indexOf("="); return [record.slice(0, split), record.slice(split + 1)]; })));
    assert.deepEqual(flacAst().parse(bytes).tracks[0]!.decodedAudio!.channelData,
      flacAst().parse(input).tracks[0]!.decodedAudio!.channelData);
    assert.deepEqual(output.nodes.find(node => node.type === "FRAMES")!.data, frames);
  });
}
