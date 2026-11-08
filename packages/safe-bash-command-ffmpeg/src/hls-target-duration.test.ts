import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const type of ["mpegts", "fmp4"]) {
  for (const entry of [
    { name: "fractional segments", time: "1.2", size: "0", previous: false, target: 1, sequence: 0, durations: [1.2, 1.2, 1] },
    { name: "short final window", time: "1", size: "1", previous: false, target: 0, sequence: 3, durations: [0.4] },
    { name: "retained appended segment", time: "1.2", size: "0", previous: true, target: 2, sequence: 0, durations: [2.4, 1.2, 1.2, 1] },
    { name: "expired appended segment", time: "1", size: "1", previous: true, target: 0, sequence: 4, durations: [0.4] }
  ]) {
    it(`computes ${type} target duration from ${entry.name}`, async () => {
      const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 10, frameCount: 34, includeAudio: false }));
      const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
        samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
      })) });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      if (entry.previous) volume.writeFileSync("/out.m3u8", "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:2.400000,\nold.ts\n");
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_list_size", entry.size,
          "-hls_time", entry.time, "-hls_segment_type", type, ...(entry.previous ? ["-hls_flags", "append_list"] : []), "/out.m3u8"],
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
      const lines = String(volume.readFileSync("/out.m3u8")).trim().split("\n");
      assert.deepEqual(lines.filter(line => line.startsWith("#EXTINF:")), entry.durations.map(duration => `#EXTINF:${duration.toFixed(6)},`));
      assert.ok(lines.includes(`#EXT-X-MEDIA-SEQUENCE:${entry.sequence}`));
      assert.ok(lines.includes(`#EXT-X-TARGETDURATION:${entry.target}`), lines.join("\n"));
    });
  }
}
