import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAvi, parseMkv, parseFlv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native fixture: ffmpeg -f lavfi -i testsrc2=s=64x48:r=5:d=2 -f lavfi -i sine=f=880:r=44100:d=2
// -c:v flv1 -threads 1 -c:a libmp3lame legacy.flv
const fixture = readFileSync(new URL("../../mp4-ast/src/fixtures/legacy.flv", import.meta.url));

// AVI/MKV fixtures: ffmpeg -f lavfi -i testsrc2=s=64x48:r=5:d=2 -c:v flv1 -threads 1 flv1.avi
// ffmpeg -i flv1.avi -map 0:v -c copy flv1.mkv
for (const format of ["flv", "avi", "mkv"] as const) {
  const input = format === "flv" ? fixture : readFileSync(new URL(`../../mp4-ast/src/fixtures/flv1.${format}`, import.meta.url));
  for (const sync of [false, true]) {
    it(`${sync ? "sync video-only copy" : "async video map"} FLV1 from ${format} preserves legacy packets and timing`, async () => {
      const volume = Volume.fromJSON({ [`/in.${format}`]: input });
      const args = ["-y", "-v", "error", "-i", `/in.${format}`, ...(sync ? ["-an"] : ["-map", "0:v"]), "-c", "copy", "/out.flv"];
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
      const copied = parseFlv(new Uint8Array(volume.readFileSync("/out.flv") as Buffer));
      const source = (format === "avi" ? parseAvi : format === "mkv" ? parseMkv : parseFlv)(new Uint8Array(input));
      assert.equal(source.tracks[0]?.codecDescriptions[0]?.codecName, "flv1");
      assert.equal(copied.tracks.length, 1);
      const track = copied.tracks[0]!;
      assert.equal(track.type, "video");
      assert.equal(track.codecDescriptions[0]?.codecName, "flv1");
      assert.equal(track.width, 64);
      assert.equal(track.height, 48);
      assert.equal(track.samples.length, 10);
      assert.deepEqual(track.samples.map(sample => sample.dts), Array.from({ length: 10 }, (_, i) => (format === "flv" ? 25 : 0) + i * 200));
      assert.deepEqual(track.samples.map(sample => sample.isKeyframe), [true, ...Array(9).fill(false)]);
      assert.deepEqual(track.samples.map(sample => sample.data), source.tracks[0]!.samples.map(sample => sample.data));
    });
  }
}
