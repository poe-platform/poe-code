import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const levels = [16, 17, 18, 30, 90, 235];
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
  ...levels.map(value => Buffer.concat([
    Buffer.from("FRAME\n"), Buffer.from([value, 128, 128].flatMap(sample => Array(4).fill(sample)))
  ]))
]);

async function render(filter: string, graph = false, source = input) {
  const volume = Volume.fromJSON({ "/in.y4m": source, "/out.raw": "KEEP" });
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.y4m",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[o]`, "-map", "[o]"] : ["-vf", filter]),
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.y4m"), source);
  return { result, stderr: Buffer.concat(errors).toString(), bytes: volume.readFileSync("/out.raw") };
}

// Captured with FFmpeg 7.0.2: bypass emits the oldest buffered frame, while
// the equal-weight accumulator advances only on enabled frames.
for (const [filter, luma, chroma] of [
  ["null", levels, [128, 128, 128, 128, 128, 128]],
  ["tmix=frames=2", [16, 17, 18, 24, 60, 163], [128, 128, 128, 128, 128, 128]],
  ["tmix=frames=2:enable=0", [16, 16, 17, 18, 30, 90], [128, 128, 128, 128, 128, 128]],
  ["tmix=frames=2:enable=1", [16, 17, 18, 24, 60, 163], [128, 128, 128, 128, 128, 128]],
  ["tmix=enable=gte(t\\,0.4)", [16, 16, 6, 11, 35, 107], [128, 128, 43, 43, 43, 43]],
  ["tmix=enable='gte(n,2)'", [16, 16, 6, 11, 35, 107], [128, 128, 43, 43, 43, 43]],
  ["tmix=frames=1:enable=0", levels, [128, 128, 128, 128, 128, 128]],
  ["tmix=enable='lt(t,0.4)'", [16, 16, 16, 17, 18, 30], [128, 128, 128, 128, 128, 128]],
  ["tmix=enable='not(mod(n,2))'", [16, 16, 17, 17, 41, 30], [128, 128, 128, 128, 128, 128]],
  ["tmix=weights=1 2 1:enable='gte(t,0.4)'", [16, 16, 17, 21, 42, 111], [128, 128, 128, 128, 128, 128]],
  ["tmix=enable=0.25", [16, 16, 16, 17, 18, 30], [128, 128, 128, 128, 128, 128]],
  ["tmix=enable=-0.5", [16, 16, 17, 22, 46, 118], [128, 128, 128, 128, 128, 128]],
  ["tmix=enable=isnan(NAN)", [16, 16, 17, 22, 46, 118], [128, 128, 128, 128, 128, 128]],
  ["tmix=enable=0/0", [16, 16, 16, 17, 18, 30], [128, 128, 128, 128, 128, 128]],
  ["tmix=enable='gte(t,0.4)',select='lt(t,0.2)'", [16, 16], [128, 128]],
  ["setpts=PTS+2/TB,tmix=enable='gte(t,2.4)'", [16, 16, 6, 11, 35, 107], [128, 128, 43, 43, 43, 43]]
] as const) {
  for (const graph of [false, true]) it(`tmix timeline ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const { result, stderr, bytes } = await render(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(bytes, Buffer.from(luma.flatMap((value, index) =>
      [value, chroma[index], chroma[index]].flatMap(sample => Array(4).fill(sample)))));
  });
}

for (const expression of ["", "unknown", "gte(t,)", "gte(t,0.4"]) {
  it(`tmix rejects invalid enable=${expression} before replacing output`, async () => {
    const { result, stderr, bytes } = await render(`tmix=enable='${expression}'`);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("tmix"), stderr);
    assert.equal(bytes.toString(), "KEEP");
  });
}

const colors = [[55, 80, 172], [55, 180, 60], [122, 62, 72], [230, 20, 230], [60, 120, 100], [80, 176, 90]];
for (const [filter, samples, expected] of [
  ["tmix=frames=2:enable=0", colors, [colors[0], ...colors.slice(0, -1)]],
  ["tmix=frames=2:enable=1", colors, [[55, 80, 172], [55, 130, 116], [89, 121, 66], [176, 41, 151], [145, 70, 165], [70, 148, 95]]],
  ["tmix=enable='gte(t,0.4)'", colors, [[55, 80, 172], [55, 80, 172], [41, 21, 24], [99, 1, 43], [101, 66, 57], [87, 19, 63]]],
  ["tmix=enable='gte(t,0.4)'", Array(6).fill([64, 128, 128]), [[64, 128, 128], [64, 128, 128], ...Array(4).fill([21, 43, 43])]]
] as const) {
  it(`tmix preserves native YUV accumulator samples: ${filter} (${samples === colors ? "color" : "constant"})`, async () => {
    const source = Buffer.concat([
      Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
      ...samples.flatMap(frame => [Buffer.from("FRAME\n"), Buffer.from(frame.flatMap((value: number) => Array(4).fill(value)))])
    ]);
    const { result, stderr, bytes } = await render(filter, false, source);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(bytes, Buffer.from(expected.flatMap(frame => frame!.flatMap((value: number) => Array(4).fill(value)))));
  });
}
