import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { decodeH264Samples, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const images = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]].map(color =>
  encodeImage({
    width: 16, height: 16, channels: 4,
    data: Uint8Array.from({ length: 16 * 16 * 4 }, (_, i) => color[i % 4]!),
    format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
  }, { format: "png" }).data
);
const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;

for (const [rate, fps] of [
  ["30000/1001", 30000 / 1001], ["3/2", 1.5], ["1.5", 1.5], ["2", 2],
  ["ntsc", 30000 / 1001], ["pal", 25], ["qntsc", 30000 / 1001], ["qpal", 25],
  ["sntsc", 30000 / 1001], ["spal", 25], ["film", 24], ["ntsc-film", 24000 / 1001]
] as const) {
  it(`preserves image sequence timing at ${rate}`, async t => {
    const volume = Volume.fromJSON({});
    images.forEach((bytes, i) => volume.writeFileSync(`/f0${i}.png`, bytes));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-framerate", rate, "-i", "/f%02d.png", "-c:v", "libx264", "/out.mp4"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.deepEqual(volume.readdirSync("/"), ["f00.png", "f01.png", "f02.png", "out.mp4"]);
    const output = volume.readFileSync("/out.mp4") as Buffer;
    const track = parseMp4(output).tracks.find(track => track.type === "video")!;
    const frames = [...decodeH264Samples(track.samples, track.codecDescriptions, 16, 16, track.timescale)];
    assert.equal(frames.length, 3);
    frames.forEach((frame, i) => assert.ok(Math.abs(frame.ptsSeconds - i / fps) < 0.00002,
      `frame ${i}: ${frame.ptsSeconds}, expected ${i / fps}`));
    await t.test("matches native FFmpeg MP4 decoded timestamps", { skip: !nativeAvailable }, () => {
      const native = spawnSync("ffmpeg", [
        "-v", "error", "-framerate", rate, "-f", "image2pipe", "-i", "pipe:0",
        "-c:v", "libx264", "-bf", "0", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"
      ], { input: Buffer.concat(images) });
      assert.equal(native.status, 0, native.stderr.toString());
      const timestamps = (input: Uint8Array) => {
        const decoded = spawnSync("ffmpeg", ["-hide_banner", "-i", "pipe:0", "-vf", "showinfo", "-f", "null", "-"], { input });
        assert.equal(decoded.status, 0, decoded.stderr.toString());
        return [...decoded.stderr.toString().matchAll(/pts_time:([\d.]+)/g)].map(match => Number(match[1]));
      };
      const actual = timestamps(output);
      const expected = timestamps(native.stdout);
      assert.equal(actual.length, 3);
      assert.equal(expected.length, 3);
      actual.forEach((time, i) => assert.ok(Math.abs(time - expected[i]!) < 0.00002));
    });
  });
}
