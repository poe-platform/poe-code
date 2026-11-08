import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const fragmented of [false, true]) {
    for (const [rotation, expected] of [
      [undefined, [-65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824]],
      [90, [0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824]],
      [-90, [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824]],
      [45, [46340, -46340, 0, 46340, 46340, 0, 0, 0, 1073741824]],
      [32.5, [55272, -35212, 0, 35212, 55272, 0, 0, 0, 1073741824]],
      [-32.5, [55272, 35212, 0, -35212, 55272, 0, 0, 0, 1073741824]],
      [0, [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824]]
    ] as const) {
      it(`writes the requested display matrix during stream copy (sync=${sync}, fragmented=${fragmented}, rotation=${rotation})`, async () => {
        const matrix = [-65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
        const base = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 2 }));
        const input = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track, rotation: undefined, matrix })) });
        const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
        const args = ["-y", "-v", "error", ...(rotation === undefined ? [] : ["-display_rotation", String(rotation)]), "-i", "/in.mp4", "-c", "copy",
          ...(fragmented ? ["-movflags", "frag_keyframe+empty_moov"] : []), "/out.mp4"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
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
        const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
        assert.deepEqual(output.tracks[0]!.matrix, expected);
        assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), parseMp4(volume.readFileSync("/in.mp4") as Buffer).tracks[0]!.samples.map(sample => sample.data));
      });
    }
  }
}
