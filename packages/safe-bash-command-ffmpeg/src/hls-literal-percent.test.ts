import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const type of ["mpegts", "fmp4"]) {
  for (const literal of ["p", "%%p", "%%%%p"]) {
    it(`preserves literal ${literal} beside a padded HLS index (${type})`, async () => {
      const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 1, frameCount: 4, includeAudio: false }));
      const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
        samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
      })) });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      const extension = type === "fmp4" ? "m4s" : "ts";
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "in.mp4", "-c", "copy", "-f", "hls", "-hls_time", "1",
          "-hls_segment_type", type, "-hls_segment_filename", `out/x${literal}%02d.${extension}`, "out/main.m3u8"],
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
      const names = [0, 1, 2, 3].map(index => `x${literal}0${index}.${extension}`);
      const playlist = String(volume.readFileSync("/out/main.m3u8"));
      assert.deepEqual(playlist.trim().split("\n").filter(line => !line.startsWith("#")), names);
      assert.deepEqual(volume.readdirSync("/out").sort(), [...names, "main.m3u8", ...(type === "fmp4" ? ["init.mp4"] : [])].sort());
      for (const name of names) assert.ok(volume.statSync(`/out/${name}`).size > 0);
    });
  }
}
