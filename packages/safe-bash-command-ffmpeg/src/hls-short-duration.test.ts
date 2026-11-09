import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, parseMpegTs } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: two seconds at 20 fps, with every frame a keyframe.
const input = readFileSync(new URL("./fixtures/hls-dense-keyframes.mp4", import.meta.url));

for (const type of ["mpegts", "fmp4"]) {
  for (const time of ["0.05", "0", "0.2"]) {
    it(`honors hls_time=${time} at dense keyframes in ${type}`, async () => {
      const volume = Volume.fromJSON({ "/in.mp4": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.mp4", "-c", "copy", "-f", "hls",
          "-hls_list_size", "0", "-hls_time", "1", "-hls_time", time,
          "-hls_segment_type", type, "/out.m3u8"],
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
      const duration = time === "0.2" ? 0.2 : 0.05;
      const count = time === "0.2" ? 10 : 40;
      const lines = String(volume.readFileSync("/out.m3u8")).trim().split("\n");
      assert.deepEqual(lines.filter(line => line.startsWith("#EXTINF:")),
        Array.from({ length: count }, () => `#EXTINF:${duration.toFixed(6)},`));
      const extension = type === "fmp4" ? "m4s" : "ts";
      const paths = Array.from({ length: count }, (_, index) => `out${index}.${extension}`);
      assert.deepEqual(lines.filter(line => !line.startsWith("#")), paths);
      assert.equal(volume.readdirSync("/").filter(name => String(name).endsWith(`.${extension}`)).length, count);
      const init = type === "fmp4" ? volume.readFileSync("/init.mp4") as Buffer : Buffer.alloc(0);
      for (const [index, path] of paths.entries()) {
        const bytes = volume.readFileSync(`/${path}`) as Buffer;
        const segment = type === "fmp4" ? parseMp4(Buffer.concat([init, bytes])) : parseMpegTs(bytes);
        const track = segment.tracks.find(track => track.type === "video")!;
        assert.equal(track.samples.length, duration * 20);
        if (type === "fmp4") assert.equal(track.samples[0]!.dts, Math.round(index * duration * track.timescale));
      }
    });
  }
}
