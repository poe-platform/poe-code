import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const type of ["mpegts", "fmp4"]) {
  for (const value of [undefined, "0", "1", "-1", "2", "", "invalid", "0.5", "2147483648", "-2147483649"]) {
    it(`honors hls_allow_cache=${value} for ${type}`, async () => {
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(createSyntheticMp4({
        width: 16, height: 16, fps: 10, frameCount: 34, includeAudio: true
      })) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/in.mp4", "-map", "0:a", "-c", "copy", "-f", "hls",
          "-hls_time", "1", "-hls_list_size", "0", "-hls_segment_type", type,
          ...(value === undefined ? [] : ["-hls_allow_cache", value]), "/media.m3u8"],
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
      if (value !== undefined && !["0", "1", "-1", "2"].includes(value)) {
        assert.equal(result.exitCode, 1, stderr);
        assert.ok(stderr.includes("invalid hls_allow_cache"));
        assert.deepEqual(volume.readdirSync("/"), ["in.mp4"]);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const lines = String(volume.readFileSync("/media.m3u8")).trim().split("\n");
      assert.deepEqual(lines.filter(line => line.startsWith("#EXT-X-ALLOW-CACHE:")),
        value === "0" ? ["#EXT-X-ALLOW-CACHE:NO"] : value === "1" ? ["#EXT-X-ALLOW-CACHE:YES"] : []);
      const segments = lines.filter(line => !line.startsWith("#"));
      assert.ok(segments.length > 1);
      for (const segment of segments) assert.ok(volume.statSync(`/${segment}`).size > 0);
      if (type === "fmp4") assert.ok(volume.statSync("/init.mp4").size > 0);
    });
  }
}
