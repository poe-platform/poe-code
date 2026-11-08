import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const type of ["mpegts", "fmp4"]) {
  for (const [flags, enabled, version] of [
    [[], false, 3],
    [["iframes_only"], true, 4],
    [["+iframes_only"], true, 4],
    [["round_durations+iframes_only"], true, 4],
    [["single_file+iframes_only"], true, 4],
    [["independent_segments+iframes_only"], true, 6],
    [["iframes_only", "+omit_endlist"], true, 4],
    [["iframes_only", "round_durations"], false, 2],
    [["iframes_only-iframes_only"], false, 3],
    [["iframes_only", "-iframes_only"], false, 3]
  ] as const) {
    it(`signals I-frame ${type} playlists with flags=${flags.join(";")}`, async () => {
      const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 5, frameCount: 20, includeAudio: false }));
      const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
        samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 5 === 0 }))
      })) });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/in.mp4", "-map", "0:v", "-c", "copy", "-f", "hls", "-hls_time", "1", "-hls_list_size", "0",
          "-hls_segment_type", type, ...flags.flatMap(flag => ["-hls_flags", flag]), "/out.m3u8"],
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
      assert.equal(lines[1], `#EXT-X-VERSION:${type === "fmp4" ? 7 : version}`);
      assert.equal(lines.filter(line => line === "#EXT-X-I-FRAMES-ONLY").length, enabled ? 1 : 0);
      if (enabled) assert.ok(lines.indexOf("#EXT-X-I-FRAMES-ONLY") < lines.findIndex(line => line.startsWith("#EXTINF:")));
      const paths = lines.filter(line => !line.startsWith("#"));
      assert.equal(paths.length, 4);
      for (const path of paths) assert.ok(volume.statSync(`/${path}`).size > 0);
    });
  }
}
