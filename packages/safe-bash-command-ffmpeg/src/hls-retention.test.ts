import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const option of ["hls_list_size", "hls_delete_threshold"]) {
  for (const value of ["2147483647", "2147483648"]) {
    it(`${option}=${value} respects the signed 32-bit upper bound before writing`, async () => {
      const volume = Volume.fromJSON({
        "/in.mp4": Buffer.from(createSyntheticMp4({
          width: 16, height: 16, fps: 10, frameCount: 20, includeAudio: true
        })),
        "/out.m3u8": "EXISTING"
      });
      const before = volume.toJSON();
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-i", "/in.mp4", "-map", "0:a", "-c", "copy", "-f", "hls",
          "-hls_list_size", "0", "-hls_time", "1", `-${option}`, value, "/out.m3u8"],
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
      if (value === "2147483648") {
        assert.equal(result.exitCode, 1, stderr);
        assert.ok(stderr.includes(`invalid ${option}`), stderr);
        assert.deepEqual(volume.toJSON(), before);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const playlist = String(volume.readFileSync("/out.m3u8"));
        assert.ok(playlist.startsWith("#EXTM3U"), playlist);
        const segments = playlist.trim().split("\n").filter(line => !line.startsWith("#"));
        assert.equal(segments.length, 2);
        for (const segment of segments) assert.ok(volume.statSync(`/${segment}`).size > 0);
      }
    });
  }
}
