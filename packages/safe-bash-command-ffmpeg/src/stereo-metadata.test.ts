import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv, serializeMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const source = parseMkv(readFileSync(new URL("../../mp4-ast/src/fixtures/vp9-stereo.webm", import.meta.url)));
const video = source.tracks[0]!;

for (const sync of [false, true]) {
  for (const extension of ["mkv", "webm"]) {
    for (const stereoMode of [undefined, 1, 11, 3]) {
      for (const edit of [false, true]) {
        it(`${sync ? "sync" : "async"} ${extension} ${edit ? "edits" : "preserves"} stereo layout ${stereoMode ?? "absence"} without changing packets`, async () => {
          const input = serializeMkv({ ...source, tracks: [
            { ...video, samples: video.samples.slice(0, 2), codecDescriptions: video.codecDescriptions.map(codec => ({ ...codec, stereoMode })) },
            { ...video, id: 2, samples: video.samples.slice(0, 2) }
          ] });
          const volume = Volume.fromJSON({ "/in.mkv": Buffer.from(input) });
          const args = ["-y", "-v", "error", "-i", "/in.mkv", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy",
            ...(edit ? ["-metadata:s:v:0", "stereo_mode=right_left"] : []), `/out.${extension}`];
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined,
              path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
              (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          } else {
            const errors: Uint8Array[] = [];
            const result = await createFfmpegCommand().execute({
              args, cwd: "/", env: {}, signal: new AbortController().signal,
              fs: {
                async readFile(path: string) { return volume.readFileSync(path); },
                async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
                async stat(path: string) { return volume.statSync(path); }
              },
              stdin: (async function* () {})(), stdout: { async write() {} },
              stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
            } as never);
            assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
          }
          const copied = parseMkv(volume.readFileSync(`/out.${extension}`) as Buffer);
          assert.equal(copied.tracks[0]!.codecDescriptions[0]!.stereoMode, edit ? 11 : stereoMode);
          assert.deepEqual(copied.tracks[0]!.samples.map(sample => sample.data), video.samples.slice(0, 2).map(sample => sample.data));
          if (!sync) {
            assert.equal(copied.tracks.length, 2);
            assert.equal(copied.tracks[1]!.codecDescriptions[0]!.stereoMode, 1);
            assert.deepEqual(copied.tracks[1]!.samples.map(sample => sample.data), video.samples.slice(0, 2).map(sample => sample.data));
          }
        });
      }
    }
  }
}
