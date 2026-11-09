import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [numeric, named, extension, version] of [["0", "mpegts", "ts", "3"], ["1", "fmp4", "m4s", "7"]]) {
  it(`writes identical HLS playlists and media for ${numeric} and ${named}`, async () => {
    const input = Buffer.from(createSyntheticMp4({ width: 16, height: 16, fps: 1, frameCount: 3, includeAudio: false }));
    const outputs = [];
    for (const type of [named, numeric]) {
      const volume = Volume.fromJSON({ "/in.mp4": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-i", "/in.mp4", "-c", "copy", "-f", "hls", "-hls_time", "1",
          "-hls_segment_type", type, "/out/main.m3u8"],
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
      const playlist = String(volume.readFileSync("/out/main.m3u8"));
      assert.ok(playlist.includes(`#EXT-X-VERSION:${version}\n`), playlist);
      const segments = playlist.trim().split("\n").filter(line => !line.startsWith("#"));
      assert.ok(segments.length > 0);
      for (const segment of segments) {
        assert.ok(segment.endsWith(`.${extension}`));
        assert.ok(volume.statSync(`/out/${segment}`).size > 0);
      }
      assert.equal(playlist.includes('#EXT-X-MAP:URI="init.mp4"'), named === "fmp4");
      assert.equal(volume.existsSync("/out/init.mp4"), named === "fmp4");
      outputs.push(volume.readdirSync("/out").sort().map(file => [file, volume.readFileSync(`/out/${String(file)}`)]));
    }
    assert.deepEqual(outputs[1], outputs[0]);
  });
}

for (const type of ["-1", "2", "0junk", "1junk", "", "invalid", undefined]) {
  it(`rejects invalid HLS segment type ${JSON.stringify(type)} before writing`, async () => {
    const volume = Volume.fromJSON({ "/out.m3u8": "original playlist", "/out0.ts": "original segment" });
    const before = volume.toJSON();
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.mp4", "-c", "copy", "/out.m3u8", "-hls_segment_type", ...(type === undefined ? [] : [type])],
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
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("invalid hls_segment_type"), stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}
