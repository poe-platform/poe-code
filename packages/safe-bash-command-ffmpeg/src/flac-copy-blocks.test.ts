import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAudio } from "@poe-code/audio-ast";
import { flacAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const base = readFileSync(new URL("./fixtures/metadata-16.flac", import.meta.url));
const parsed = parseAudio(base);
const streamInfo = parsed.nodes.find(node => node.type === "STREAMINFO")!.data;
const frames = parsed.nodes.find(node => node.type === "FRAMES")!.data;
const application = Buffer.from("TESTasset-note");
const seekTable = Buffer.alloc(18);
seekTable.writeUInt16BE(256, 16);

// Native FFmpeg drops APPLICATION and SEEKTABLE blocks during FLAC remuxing,
// both with default metadata mapping and with -map_metadata -1.
for (const [name, blocks] of [
  ["APPLICATION", [[2, application]]],
  ["SEEKTABLE", [[3, seekTable]]],
  ["both", [[2, application], [3, seekTable]]]
] as const) {
  const input = Buffer.concat([
    base.subarray(0, 42),
    ...blocks.map(([type, data]) => Buffer.concat([Buffer.from([type, 0, 0, data.length]), data])),
    base.subarray(42)
  ]);
  for (const removeMetadata of [false, true]) for (const sync of [false, true]) {
    it(`drops FLAC ${name} blocks (${removeMetadata ? "no metadata" : "default"}, ${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.flac": input });
      const args = ["-v", "error", "-y", "-i", "/in.flac", "-c", "copy",
        ...(removeMetadata ? ["-map_metadata", "-1"] : []), "/out.flac"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = volume.readFileSync("/out.flac") as Buffer;
      const result = parseAudio(output);
      assert.deepEqual(result.nodes.filter(node => ["APPLICATION", "SEEKTABLE"].includes(node.type)), []);
      assert.deepEqual(result.nodes.find(node => node.type === "STREAMINFO")!.data.subarray(0, 18), streamInfo.subarray(0, 18));
      assert.deepEqual(result.nodes.find(node => node.type === "FRAMES")!.data, frames);
      assert.equal(result.tags.title, removeMetadata ? undefined : "Meeting");
      assert.equal(result.tags.artist, removeMetadata ? undefined : "Alice");
      assert.deepEqual(flacAst().parse(output).tracks[0]!.decodedAudio!.channelData,
        flacAst().parse(base).tracks[0]!.decodedAudio!.channelData);
    });
  }
}
