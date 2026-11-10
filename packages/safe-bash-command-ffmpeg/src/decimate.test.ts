import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const duplicates = [12, 40, 40, 112, 144, 176, 176, 232];
const unique = [12, 40, 72, 112, 144, 176, 204, 232];
for (const [values, filter, expected] of [
  [duplicates, "null", duplicates],
  [unique, "null", unique],
  [unique, "decimate=cycle=4:mixed=1", unique],
  [unique, "decimate=mixed=true", unique],
  [duplicates, "decimate=4:mixed=1", [12, 40, 112, 144, 176, 232]],
  [unique, "decimate=cycle=4:mixed=0", [40, 72, 112, 144, 176, 232]],
  [[12, 40, 40, 112, 144, 176, 204, 232, 250], "decimate=cycle=4:mixed=1,select='between(t,0.39,0.61)'", [144, 176, 204]],
  [duplicates, "decimate=cycle=4:mixed=2", null],
  [duplicates, "decimate=cycle=4:mixed=", null],
  [duplicates, "decimate=cycle=4:mixed=oops", null],
  [duplicates, "decimate=cycle=4", [12, 40, 112, 144, 176, 232]],
  [unique, "decimate=cycle=4", [40, 72, 112, 144, 176, 232]],
  [duplicates, "decimate=4", [12, 40, 112, 144, 176, 232]],
  [duplicates, "decimate", [12, 40, 112, 144, 176, 176, 232]],
  [unique, "decimate=2", [40, 112, 144, 232]],
  [duplicates.slice(0, 7), "decimate=4", [12, 40, 112, 144, 176, 176]],
  [[12, 40, 72], "decimate=4", [12, 40, 72]],
  [[40, 40, 40, 40, 40, 40, 40, 40], "decimate=4", [40, 40, 40, 40, 40, 40]],
  [duplicates, "decimate=25", duplicates],
  [duplicates, "decimate=4,select='between(t,0.25,0.41)'", [112, 144]],
  [unique, "decimate=4,select='lt(t,0.2)'", [40]],
  [duplicates, "decimate=cycle=1", null],
  [duplicates, "decimate=cycle=26", null],
  [duplicates, "decimate=cycle=2.5", null],
  [duplicates, "decimate=cycle=oops", null],
  [duplicates, "decimate=cycle=", null],
  [duplicates, "decimate=unknown=4", null],
  [duplicates, "decimate=4:1", null]
] as const) {
  it(`decimate: ${filter} on ${values}`, async () => {
    const volume = Volume.fromJSON({ "/o01.png": "existing output" });
    for (const [i, value] of values.entries()) {
      const data = new Uint8Array(32 * 32 * 4).fill(value);
      for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
      volume.writeFileSync(`/f${i}.png`, encodeImage({ width: 32, height: 32, data,
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data);
    }
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-framerate", "10", "-i", "/f%d.png", "-vf", filter,
        "-fps_mode", "passthrough", "/o%02d.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const stderr = Buffer.concat(errors).toString();
    if (expected === null) {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("decimate:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const paths = Object.keys(volume.toJSON()).filter(path => path.startsWith("/o")).sort();
      assert.deepEqual(paths.map(path => decodeImage(new Uint8Array(volume.readFileSync(path) as Buffer)).data[0]), expected);
    }
  });
}

for (const [values, mixed, hash] of [
  [[20, 50, 65, 100, 140, 170, 180, 205, 221], 1, "0125ab102873c09947c30f9eb4ba4964e2a35c40243a2c0bd53752b7812f87f0"],
  [[20, 50, 50, 100, 140, 170, 170, 205, 221], 1, "a54694732c7bf725a01acc3b2be367b1cad13baecfe0abaa5293c23e2e488c23"],
  [[20, 50, 65, 100, 140, 170, 180, 205, 221], 0, "a1ab13a22cc753d5421dea0e35a946885b80eca54c6c8ce78de952696b2224c9"],
  [[20, 50, 50, 100, 140, 170, 170, 205, 221], 0, "a54694732c7bf725a01acc3b2be367b1cad13baecfe0abaa5293c23e2e488c23"]
] as const) {
  it(`matches native YUV444 decimation: mixed=${mixed}, values=${values}`, async () => {
    const input = Buffer.concat([
      Buffer.from("YUV4MPEG2 W32 H32 F10:1 Ip A1:1 C444\n"),
      ...values.flatMap(value => [Buffer.from("FRAME\n"), Buffer.alloc(1024, value), Buffer.alloc(2048, 128)])
    ]);
    const volume = Volume.fromJSON({ "/input.y4m": input, "/out.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/input.y4m", "-vf", `decimate=cycle=4:mixed=${mixed}`,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(createHash("sha256").update(volume.readFileSync("/out.raw")).digest("hex"), hash);
  });
}

const sceneLevels = [20, 50, 65, 100, 140, 170, 180, 205, 221];
const defaultScenes = [1, 2, 3, 5, 6, 7, 8];
const highThresholdScenes = [1, 2, 3, 4, 5, 7, 8];
for (const [filter, expected] of [
  ["null", sceneLevels.map((_, i) => i)],
  ["decimate=cycle=4", defaultScenes],
  ["decimate=cycle=4:scthresh=15", defaultScenes],
  ["decimate=cycle=4:scthresh=15.5", defaultScenes],
  ["decimate=cycle=4:scthresh=100", highThresholdScenes],
  ["decimate=4:scthresh=100", highThresholdScenes],
  ["decimate=scthresh=100:cycle=4", highThresholdScenes],
  ["decimate=scthresh=100", [1, 2, 3, 4, 5, 6, 7, 8]],
  ["decimate=cycle=4:scthresh=0", [0, 1, 2, 4, 5, 6, 8]],
  ...["-1", "100.1", "NaN", "Infinity", "oops", ""].map(value =>
    [`decimate=cycle=4:scthresh=${value}`, null] as const)
] as const) {
  it(`decimate scene threshold on native YUV: ${filter}`, async () => {
    const frames = sceneLevels.map(value => Buffer.concat([
      Buffer.alloc(32 * 32, value), Buffer.alloc(32 * 32 * 2, 128)
    ]));
    const volume = Volume.fromJSON({
      "/unique.y4m": Buffer.concat([
        Buffer.from("YUV4MPEG2 W32 H32 F10:1 Ip A1:1 C444\n"),
        ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])
      ]),
      "/out.raw": "KEEP"
    });
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/unique.y4m", "-vf", filter,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const stderr = Buffer.concat(errors).toString();
    if (expected === null) {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("decimate:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(expected.map(i => frames[i]!)));
    }
  });
}
