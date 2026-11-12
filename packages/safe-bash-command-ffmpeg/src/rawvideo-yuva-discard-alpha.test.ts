import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 exits 0 for each conversion, including out-of-gamut YUV.
const input = Buffer.from("2525252581246d6d6d6d", "hex");
const cases = [
  { format: "yuv420p", expected: "252525258124" },
  { format: "yuv444p", expected: "252525258181818124242424" },
  { format: "gray", expected: "18181818" }
];

async function run(bytes: Buffer, size: string, format: string, filter: string,
  options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.raw": bytes });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-f", "rawvideo", "-pix_fmt", "yuva420p", "-s", size, "-r", "4",
      "-i", "/in.raw", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format,
      "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), bytes);
  return { ...result, stderr, output: Buffer.concat(stdout) };
}

for (const { format, expected } of cases) {
  for (const filter of ["null", `format=${format}`]) {
    it(`discards YUVA420 alpha through ${filter} to ${format} without clipping native planes`, async () => {
      const result = await run(input, "2x2", format, filter);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.output.toString("hex"), expected);
    });
  }
}

it("preserves all YUVA420 planes across multiple frames when retaining alpha", async () => {
  const bytes = Buffer.concat([Buffer.from("0b0b0b0b206414141414", "hex"), input]);
  const result = await run(bytes, "2x2", "yuva420p", "null");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, bytes);
});

it("drops only alpha for odd dimensions and multiple frames", async () => {
  const planes = Buffer.from("00102580ebff102030002481ff102080f0", "hex");
  const bytes = Buffer.concat([planes, Buffer.alloc(9, 0), planes, Buffer.alloc(9, 255)]);
  const result = await run(bytes, "3x3", "yuv420p", "null");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([planes, planes]));
});

it("checks the output limit before emitting converted YUV planes", async () => {
  const result = await run(input, "2x2", "yuv420p", "null", { limits: { maxOutputBytes: 5 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.output.length, 0);
});
