import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, format: string, filter: string, complex = false, outputFormat = format) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const argumentValues = createCommandArguments([
    "-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", format,
    "-video_size", "4x2", "-framerate", "4", "-i", "/in.raw",
    ...(complex ? ["-filter_complex", `[0:v]${filter},showinfo[out]`, "-map", "[out]"]
      : ["-vf", `${filter},showinfo`]),
    "-fps_mode", "passthrough", "-pix_fmt", outputFormat, "-f", "rawvideo", "pipe:1"
  ]);
  const output: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    command: "ffmpeg", args: argumentValues.args, argumentValues,
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { bytes: Buffer.concat(output), stderr };
}

for (const format of ["rgb48le", "rgb48be", "rgba64le", "rgba64be"]) {
  const pixelBytes = format.startsWith("rgba") ? 8 : 6;
  const input = Buffer.from(Array.from({ length: 16 * pixelBytes }, (_, i) => (i * 53 + 39) % 256));
  it(`preserves ${format} words through the null control`, async () => {
    assert.deepEqual((await run(input, format, "null")).bytes, input);
  });

  for (const [layout, order, count] of [
    ["1x1", [0, 1, 2, 3, 4, 5, 6, 7], 1],
    ["2x1", [0, 1, 4, 5, 2, 3, 6, 7], 2],
    ["1x2", [0, 1, 2, 3, 4, 5, 6, 7], 2],
    ["2x2", [0, 1, 2, 3, 4, 5, 6, 7], 4]
  ] as const) {
    const expected = Buffer.concat([0, 8].flatMap(base => order.map(pixel =>
      input.subarray((base + pixel) * pixelBytes, (base + pixel + 1) * pixelBytes))));
    for (const complex of [false, true]) {
      it(`extracts exact ${format} samples with untile=${layout} (complex=${complex})`, async () => {
        const { bytes, stderr } = await run(input, format, `untile=${layout}`, complex);
        assert.deepEqual(bytes, expected);
        const frames = stderr.split("\n").filter(line => line.includes(" pts_time:"));
        assert.equal(frames.length, 2 * count);
        for (const [index, line] of frames.entries()) {
          assert.ok(line.includes(` pts_time:${index / (4 * count)} `), line);
        }
      });
    }
  }

  it(`converts extracted ${format} samples to the opposite byte order`, async () => {
    const expected = (await run(input, format, "untile=2x1")).bytes;
    const otherFormat = format.slice(0, -2) + (format.endsWith("le") ? "be" : "le");
    assert.deepEqual((await run(input, format, "untile=2x1", false, otherFormat)).bytes,
      Buffer.from(expected).swap16());
  });

  it(`does not restore stale ${format} samples after upstream RGB filtering`, async () => {
    const filter = "format=rgba,negate";
    assert.deepEqual((await run(input, format, `${filter},untile=1x1`)).bytes,
      (await run(input, format, filter)).bytes);
  });

  it(`renders extracted ${format} samples for downstream RGB filtering`, async () => {
    assert.deepEqual((await run(input, format, "untile=1x1,format=rgba,negate", false, "rgba")).bytes,
      (await run(input, format, "format=rgba,negate", false, "rgba")).bytes);
  });
}

// FFmpeg 7.0.2: direct 4x2 raw sheets, untile=2x1, passthrough timestamps.
for (const [format, length, hex] of [
  ["rgb48le", 48, "275c91c6fb30659acf04396e1f5489bef3285d92c7fc3166a3d80d4277ace1164b80b5ea9bd0053a6fa4d90e4378ade2"],
  ["rgba64be", 64, "275c91c6fb30659acf04396ea3d80d42c7fc31669bd0053a6fa4d90e4378ade277ace1164b80b5ea1f5489bef3285d92174c81b6eb20558abff4295e93c8fd32"]
] as const) {
  it(`matches native FFmpeg ${format} bytes and frame timestamps`, async () => {
    const input = Buffer.from(Array.from({ length }, (_, i) => (i * 53 + 39) % 256));
    const { bytes, stderr } = await run(input, format, "untile=2x1");
    assert.equal(bytes.toString("hex"), hex);
    assert.ok(stderr.includes("n:0 pts:0 pts_time:0 "), stderr);
    assert.ok(stderr.includes("n:1 pts:1 pts_time:0.125 "), stderr);
  });
}
