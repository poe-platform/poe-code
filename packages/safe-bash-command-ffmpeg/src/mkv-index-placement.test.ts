import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv } from "@poe-code/mp4-ast";
function readVint(bytes: Uint8Array, offset: number, size: boolean) {
  let length = 1;
  while (length <= 8 && (bytes[offset]! & (0x80 >> (length - 1))) === 0) length++;
  assert.ok(length <= 8 && offset + length <= bytes.length);
  let value = size ? bytes[offset]! & (0xff >> length) : bytes[offset]!;
  for (let i = 1; i < length; i++) value = value * 256 + bytes[offset + i]!;
  return { value, length };
}
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/mkv-keyframes.webm", import.meta.url));
const cases = [
  { args: [], front: false },
  { args: ["-cues_to_front", "0"], front: false },
  { args: ["-cues_to_front", "1"], front: true },
  { args: ["-reserve_index_space", "512"], front: true },
  { args: ["-reserve_index_space", "16", "-cues_to_front", "1"], front: true },
  { args: ["-reserve_index_space", "16"], error: true },
  { args: ["-cues_to_front", "garbage"], error: true }
];
for (const sync of [false, true]) {
  for (const format of ["mkv", "webm"]) {
    for (const example of cases) {
      it(`copies ${format} with ${example.args.join(" ") || "default index"} (sync=${sync})`, async () => {
        const output = `/out.${format}`;
        const volume = Volume.fromJSON({ "/in.webm": input, [output]: "KEEP" });
        const args = ["-y", "-i", "/in.webm", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy", ...example.args, output];
        let error = "";
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined, path => new Uint8Array(volume.readFileSync(path) as Buffer),
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          assert.equal(result, example.error ? undefined : "");
        } else {
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { error += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode === 0, !example.error, error);
        }
        const bytes = new Uint8Array(volume.readFileSync(output) as Buffer);
        if (example.error) {
          assert.deepEqual(bytes, new TextEncoder().encode("KEEP"));
          return;
        }
        // Traverse EBML boundaries, never search packet payloads for index signatures.
        const positions = new Map<number, number>();
        for (let pos = 0; pos < bytes.length;) {
          const id = readVint(bytes, pos, false)!;
          const size = readVint(bytes, pos + id.length, true)!;
          positions.set(id.value, pos);
          pos += id.length + size.length + (id.value === 0x18538067 ? 0 : size.value);
        }
        assert.ok(positions.has(0x1c53bb6b), "Cues are written");
        assert.equal(positions.get(0x1c53bb6b)! < positions.get(0x1f43b675)!, example.front);
        const packets = (data: Uint8Array) => parseMkv(data).tracks[0]!.samples.map(sample => [sample.pts, sample.isKeyframe, sample.data]);
        assert.deepEqual(packets(bytes), packets(new Uint8Array(input)));
      });
    }
  }
}
