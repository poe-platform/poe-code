import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const type of ["mpegts", "fmp4"]) {
  for (const audio of [false, true]) {
    it(`writes a ${type} ${audio ? "audio" : "video"} HLS master beside its media playlist`, async () => {
      const input = readFileSync(new URL(`./fixtures/${audio ? "aac-cutoff.m4a" : "output-seek.mp4"}`, import.meta.url));
      const volume = Volume.fromJSON({ "/in.mp4": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/in.mp4", "-map", audio ? "0:a" : "0:v", "-c", "copy", "-f", "hls",
          "-hls_time", "1", "-hls_list_size", "0", "-hls_segment_type", type,
          "-master_pl_name", "master.m3u8", "/nested/media.m3u8"],
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
      const lines = String(volume.readFileSync("/nested/master.m3u8")).trim().split("\n");
      assert.equal(lines[0], "#EXTM3U");
      const stream = lines.find(line => line.startsWith("#EXT-X-STREAM-INF:"))!;
      assert.ok(stream);
      const bandwidth = stream.split("BANDWIDTH=")[1]!.split(",")[0]!;
      assert.ok(Number.isSafeInteger(Number(bandwidth)) && Number(bandwidth) > 0);
      assert.ok(stream.includes(`CODECS="${audio ? "mp4a.40.2" : "avc1.64000a"}"`), stream);
      assert.equal(stream.includes("RESOLUTION="), !audio);
      if (!audio) assert.ok(stream.includes("RESOLUTION=64x48"), stream);
      assert.equal(lines.at(-1), "media.m3u8");
      assert.ok(volume.existsSync(`/nested/${lines.at(-1)}`));
    });
  }
}

for (const collision of [false, true]) {
  it(`preserves files when the master ${collision ? "matches the media path" : "already exists"}`, async () => {
    const volume = Volume.fromJSON({
      "/in.mp4": readFileSync(new URL("./fixtures/output-seek.mp4", import.meta.url)),
      "/master.m3u8": "existing master"
    });
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.mp4", "-c", "copy", "-master_pl_name",
        collision ? "media.m3u8" : "master.m3u8", "/media.m3u8"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); },
        async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, 1);
    assert.equal(String(volume.readFileSync("/master.m3u8")), "existing master");
    assert.equal(volume.existsSync("/media.m3u8"), false);
    assert.equal(volume.existsSync("/media0.ts"), false);
  });
}
