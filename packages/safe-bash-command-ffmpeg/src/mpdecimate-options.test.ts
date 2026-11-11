import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const levels = [32, 32, 32, 32, 32, 32, 160, 160, 160, 32, 32, 32, 32];
const frames = levels.map(y => Buffer.concat([Buffer.alloc(256, y), Buffer.alloc(128, 128)]));
const max1 = [0, 2, 4, 6, 8, 9, 11];
const keep2 = [0, 1, 2, 6, 7, 8, 9];
// Frame bytes and PTS independently checked against FFmpeg 7.0.2.
const cases: [string, readonly number[] | null, Buffer[]?, number?][] = [
  ["", [0, 6, 9]],
  ["max=1", max1],
  ["max=-3", [0, 1, 3, 4, 6, 7, 9, 10, 12]],
  ["keep=2", keep2],
  ["hi=-1", levels.map((_, i) => i)],
  ["0:2:768:320:0.33", keep2],
  ["max=1:2", [0, 1, 2, 4, 5, 6, 8, 9, 10, 12]],
  ["keep=2:1", [0, 1, 6, 7, 9, 10]],
  ["max=1:keep=2:3", keep2],
  ["1:keep=2:3", keep2],
  ["max=1:max=2:", [0, 3, 6, 9, 12]],
  ["max=1:", max1],
  ["max=1.5", [0, 3, 6, 9, 12]],
  ["max=2.5", [0, 3, 6, 9, 12]],
  ["max=-2.5", max1],
  ["keep=1+1:hi=default:lo=default:frac=default", keep2],
  ...["unknown=1", "keep=-1", "keep=2147483648", "max=-2147483649", "hi=2147483648", "lo=-2147483649",
    "frac=1.1", "frac=-0.1", "frac=nan", "hi=oops", "max=", "max=1::", "0:2:768:320:0.33:1",
    "max=oops:max=1"].map(option => [option, null] as [string, null])
];
for (const chroma of [false, true]) {
  const size = chroma ? 32 : 16;
  const clip = [0, 5, 10, 15, 20].map(delta => Buffer.concat([
    Buffer.alloc(size * size, 32 + (chroma ? 0 : delta)),
    Buffer.alloc(size * size / 4, 128 + (chroma ? delta : 0)),
    Buffer.alloc(size * size / 4, 128)
  ]));
  for (const [option, expected] of [
    ["", [0, 2, 4]],
    ["hi=319:lo=10000", [0, 1, 2, 3, 4]],
    ["hi=320:lo=10000", [0, 2, 4]],
    ["hi=10000:lo=319", [0, 1, 2, 3, 4]],
    ["hi=10000:lo=320", [0, 2, 4]],
    ["lo=-1", [0, 1, 2, 3, 4]],
    ["hi=2147483647:lo=2147483647", [0]]
  ] as const) cases.push([option, expected, clip, size]);
}
const fractionFrames = Array.from({ length: 3 }, (_, i) => {
  const luma = Buffer.alloc(64 * 64, 32);
  if (i === 1) for (let y = 0; y < 8; y++) luma.fill(38, y * 64 + 8, y * 64 + 16);
  return Buffer.concat([luma, Buffer.alloc(2048, 128)]);
});
for (const [option, expected] of [["frac=0", [0, 1, 2]], ["frac=0.25", [0]], ["frac=1", [0]]] as const) {
  cases.push([option, expected, fractionFrames, 64]);
}
for (const [option, expected, input = frames, size = 16] of cases) {
  it(`mpdecimate options preserve native bytes and PTS: ${option}, ${size}x${size}`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.concat(input), "/out.raw": "KEEP" });
    const before = volume.toJSON();
    const output: Uint8Array[] = [], errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-y", "-f", "rawvideo", "-pixel_format", "yuv420p",
        "-video_size", `${size}x${size}`, "-framerate", "4", "-i", "/in.raw", "-vf",
        `mpdecimate${option ? `=${option}` : ""},showinfo`, "-fps_mode", "passthrough", "-pix_fmt", "yuv420p",
        "-f", "rawvideo", expected === null ? "/out.raw" : "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const stderr = Buffer.concat(errors).toString();
    if (expected === null) {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("mpdecimate:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(output), Buffer.concat(expected.map(i => input[i]!)));
      assert.deepEqual(Array.from(stderr.matchAll(/\bpts:\s*(-?\d+)/g), match => Number(match[1])), expected);
    }
  });
}
