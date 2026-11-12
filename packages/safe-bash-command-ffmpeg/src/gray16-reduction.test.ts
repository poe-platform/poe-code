import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, inputFormat: string, outputFormat: string, filter?: string, size = "2x2") {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pix_fmt", inputFormat, "-s", size, "-r", "4", "-i", "/in.raw",
      ...(filter ? ["-vf", filter] : []), "-fps_mode", "passthrough", "-pix_fmt", outputFormat, "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { stdout.push(data); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  return Buffer.concat(stdout);
}

// Exact output bytes and successful exit status from native FFmpeg 7.0.2.
for (const inputFormat of ["gray16le", "gray16be"]) {
  const input = Buffer.from("aba2aba2aba2aba2", "hex");
  if (inputFormat === "gray16be") input.swap16();
  for (const [outputFormat, expected] of [
    ["gray", "a2a2a2a2"],
    ["gray8", "a2a2a2a2"],
    ["yuv420p", "9b9c9c9b8080"],
    ["yuv422p", "9b9c9c9b80808080"],
    ["yuv444p", "9b9c9c9b8080808080808080"]
  ] as const) {
    for (const filter of [undefined, "null", `format=${outputFormat}`]) {
      it(`reduces ${inputFormat} to native ${outputFormat} bytes with ${filter ?? "no filter"}`, async () => {
        assert.equal((await run(input, inputFormat, outputFormat, filter)).toString("hex"), expected);
      });
    }
  }
  it(`preserves both bytes of unchanged ${inputFormat} frames`, async () => {
    const control = Buffer.from("140b140b140b140b2e252e252e252e25", "hex");
    if (inputFormat === "gray16be") control.swap16();
    assert.deepEqual(await run(control, inputFormat, inputFormat, "null"), control);
  });
}

// Native FFmpeg 7.0.2: odd dimensions, black/white endpoints, dither wrapping,
// slice boundaries and three consecutive frames with varied low sample bits.
// YUV420 checks the luma plane here; full Y/U/V bytes are covered above.
for (const [height, outputFormat, expected] of [
  [9, "gray", "31da778b8f38f06e63bbb668c7857dd9901bd465df7b1544dc32285426f00811"],
  [9, "yuv420p", "fdaf91d40fce9f3ff8921f0f8c76e099c0930b63cff561131833634ba909d345"],
  [9, "yuv422p", "3277e9ba39f516b9fe161995dbc2c9a02dc29d8ac111d5f1d6972742402a6ee5"],
  [9, "yuv444p", "01d95e85f3f2011200939a9a298fc7b35bd1cd9a211742137a7bb6c3d964c233"],
  [129, "gray", "567b4dadf6dcf20c92cf557b36e2b6c7ef0fadd197e16d81146bef5c3bc2d994"],
  [129, "yuv420p", "a622d0090e4a34c533f45c42b478d5cdac1b1cfbda4434129871e297bcdf431d"],
  [129, "yuv422p", "41e5c5342ad3df121cd9b509b0d252a77ef859db9919700f7d95cf76c1560d0f"],
  [129, "yuv444p", "405fdf5f6e83f682bd926341d1203147b9272e9f8bc6d0519dd69ae6f01600b3"]
] as const) {
  for (const inputFormat of ["gray16le", "gray16be"]) {
    it(`matches native ${outputFormat} precision across three 9x${height} ${inputFormat} frames`, async () => {
      const frame = Buffer.alloc(9 * height * 2);
      for (let pixel = 0; pixel < 9 * height; pixel++) {
        frame.writeUInt16LE(pixel === 0 ? 0 : pixel === 9 * height - 1 ? 65535 : (pixel * 977 + 17) % 65536, pixel * 2);
      }
      if (inputFormat === "gray16be") frame.swap16();
      const output = await run(Buffer.concat([frame, frame, frame]), inputFormat, outputFormat, "null", `9x${height}`);
      const frameBytes = 9 * height + 2 * 5 * Math.ceil(height / 2);
      const samples = outputFormat === "yuv420p"
        ? Buffer.concat([0, 1, 2].map(frame => output.subarray(frame * frameBytes, frame * frameBytes + 9 * height)))
        : output;
      assert.equal(createHash("sha256").update(samples).digest("hex"), expected);
    });
  }
}
