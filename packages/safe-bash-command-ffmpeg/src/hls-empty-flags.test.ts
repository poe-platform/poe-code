import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const flags of [[], ["-hls_flags", ""], ["-hls_flags", "not_a_flag"]]) {
  for (const existing of [false, true]) {
    it(`handles HLS flags ${JSON.stringify(flags)} with existing output=${existing}`, async () => {
      const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 20, frameCount: 40, includeAudio: false }));
      const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
        samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
      })) });
      const volume = Volume.fromJSON({
        "/in.mp4": Buffer.from(input),
        ...(existing ? { "/out.m3u8": "EXISTING" } : {})
      });
      const before = volume.toJSON();
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.mp4", "-c", "copy", "-f", "hls",
          "-hls_list_size", "0", "-hls_time", "1", ...flags, "/out.m3u8"],
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
      if (flags.length) {
        assert.notEqual(result.exitCode, 0, "invalid flags must fail");
        assert.ok(stderr.includes("HLS flag"), stderr);
        assert.deepEqual(volume.toJSON(), before);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const playlist = String(volume.readFileSync("/out.m3u8"));
        assert.equal(playlist, "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1.000000,\nout0.ts\n#EXTINF:1.000000,\nout1.ts\n#EXT-X-ENDLIST\n");
        for (const path of ["/out0.ts", "/out1.ts"]) assert.ok(volume.statSync(path).size > 0);
      }
    });
  }
}
