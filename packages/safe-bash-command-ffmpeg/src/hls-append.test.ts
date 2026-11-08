import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const type of ["fmp4", "mpegts"]) {
  for (const size of ["0", undefined, "7"]) {
    it(`appends ${type} fragments without overwriting previous recordings (window ${size ?? "default"})`, async () => {
      const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 4, frameCount: 20, includeAudio: false }));
      const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
        samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
      })) });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      const ext = type === "fmp4" ? "m4s" : "ts";
      const saved = new Map<string, Buffer>();
      for (let run = 0; run < 3; run++) {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_segment_type", type,
            "-hls_flags", "append_list", ...(size === undefined ? [] : ["-hls_list_size", size]), "/out.m3u8"],
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
        for (const [path, bytes] of saved) assert.deepEqual(volume.readFileSync(path), bytes, path);
        const count = (run + 1) * 5;
        const first = size === "0" ? 0 : Math.max(0, count - Number(size ?? 5));
        const lines = String(volume.readFileSync("/out.m3u8")).trim().split("\n");
        assert.ok(lines.includes(`#EXT-X-MEDIA-SEQUENCE:${first}`));
        assert.deepEqual(lines.filter(line => !line.startsWith("#")),
          Array.from({ length: count - first }, (_, index) => `out${first + index}.${ext}`));
        for (let i = first; i < count; i++) {
          const position = lines.indexOf(`out${i}.${ext}`);
          assert.equal(lines[position - 1], "#EXTINF:1.000000,");
          assert.equal(lines[position - 2] === "#EXT-X-DISCONTINUITY", i % 5 === 0);
        }
        for (let i = 0; i < count; i++) {
          const path = `/out${i}.${ext}`;
          saved.set(path, Buffer.from(volume.readFileSync(path) as Buffer));
        }
        // Change the payload so overwriting old fragments cannot accidentally pass.
        const changed = parseMp4(input);
        for (const track of changed.tracks) for (const sample of track.samples) sample.data[sample.data.length - 1] = sample.data[sample.data.length - 1]! ^ (run + 1);
        volume.writeFileSync("/in.mp4", serializeMp4(changed));
      }
    });
  }
}
