import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [values, type] of [
  [[], undefined], [["0"], undefined], [["1"], "EVENT"], [["2"], "VOD"],
  [["event"], "EVENT"], [["vod"], "VOD"], [["event", "0"], undefined]
] as const) {
  it(`applies HLS playlist type ${values.join(" then ") || "default"} to tags, windows and deletion`, async () => {
    const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 1, frameCount: 4, includeAudio: false }));
    const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
      samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
    })) });
    const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input), "/out/keep.ts": "unrelated" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.mp4", "-c", "copy", "-f", "hls", "-hls_time", "1",
        "-hls_list_size", "1", "-hls_flags", "delete_segments",
        ...values.flatMap(value => ["-hls_playlist_type", value]), "/out/main.m3u8"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); },
        async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
        async rm(path: string) { volume.unlinkSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const first = type ? 0 : 3;
    assert.equal(String(volume.readFileSync("/out/main.m3u8")), [
      "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:1", `#EXT-X-MEDIA-SEQUENCE:${first}`,
      ...(type ? [`#EXT-X-PLAYLIST-TYPE:${type}`] : []),
      ...Array.from({ length: 4 - first }, (_, index) => ["#EXTINF:1.000000,", `main${first + index}.ts`]).flat(),
      "#EXT-X-ENDLIST", ""
    ].join("\n"));
    assert.deepEqual(volume.readdirSync("/out").sort(), [
      "keep.ts", "main.m3u8", ...(type ? [0, 1, 2, 3] : [2, 3]).map(index => `main${index}.ts`)
    ]);
    assert.equal(String(volume.readFileSync("/out/keep.ts")), "unrelated");
  });
}

for (const value of ["-1", "3", "1x", "live", "VOD", "", undefined]) {
  it(`rejects invalid HLS playlist type ${JSON.stringify(value)} without changing output`, async () => {
    const volume = Volume.fromJSON({ "/out.m3u8": "original playlist", "/out0.ts": "original segment" });
    const before = volume.toJSON();
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-f", "lavfi", "-i", "color=s=16x16:d=1", "/out.m3u8",
        "-hls_playlist_type", ...(value === undefined ? [] : [value])],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); },
        async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
        async rm(path: string) { volume.unlinkSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("invalid hls_playlist_type"), stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}
