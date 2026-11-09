import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const type of ["mpegts", "fmp4"]) {
  for (const singleFile of [false, true]) {
    for (const startNumber of [undefined, 10]) {
      for (const listSize of [0, 2]) {
        it(`${type} ${singleFile ? "single-file" : "separate-file"} sequence with start=${startNumber ?? "default"}, list size=${listSize}`, async () => {
          const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 1, frameCount: 4, includeAudio: false }));
          const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
            samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
          })) });
          const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-i", "/in.mp4", "-c", "copy", "-f", "hls", "-hls_time", "1",
              "-hls_segment_type", type, "-hls_list_size", String(listSize),
              ...(singleFile ? ["-hls_flags", "single_file"] : []),
              ...(startNumber === undefined ? [] : ["-start_number", String(startNumber)]), "/out/main.m3u8"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); },
              async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          const lines = String(volume.readFileSync("/out/main.m3u8")).trim().split("\n");
          const count = listSize || 4;
          const first = (startNumber ?? 0) + 4 - count;
          // Native single-file HLS keeps sequence zero even after entries leave the window.
          assert.deepEqual(lines.filter(line => line.startsWith("#EXT-X-MEDIA-SEQUENCE:")),
            [`#EXT-X-MEDIA-SEQUENCE:${singleFile ? 0 : first}`]);
          assert.deepEqual(lines.filter(line => line.startsWith("#EXTINF:")), Array(count).fill("#EXTINF:1.000000,"));
          const extension = type === "fmp4" ? "m4s" : "ts";
          assert.deepEqual(lines.filter(line => line && !line.startsWith("#")),
            Array.from({ length: count }, (_, index) => `main${singleFile ? "" : first + index}.${extension}`));
          assert.equal(lines.filter(line => line.startsWith("#EXT-X-BYTERANGE:")).length, singleFile ? count : 0);
        });
      }
    }
  }
}
