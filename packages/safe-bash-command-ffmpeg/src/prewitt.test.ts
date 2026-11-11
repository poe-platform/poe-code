import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import type { MediaResourceLimits } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const impulse = Buffer.from(Array.from({ length: 256 }, (_, i) => 35 + 30 * Number(i % 16 >= 4) + 100 * Number(i % 16 >= 9) + 35 * Number(i >= 128)));

async function run(filter: string, input = impulse, format = "gray", size = "16x16", limits?: MediaResourceLimits) {
  const volume = Volume.fromJSON({ "/in": input, "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format, "-video_size", size,
      "-framerate", "4", "-i", "/in", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out") as Buffer };
}

const yuv = Buffer.from(Array.from({ length: 768 }, (_, i) => {
  const p = Math.floor(i / 256), x = i % 16, y = Math.floor(i % 256 / 16);
  return 30 + 12 * p + 35 * Number(x >= 3 + p) + 75 * Number(y >= 8 - p);
}));

for (const [filter, input, format, hash] of [
  ["null", impulse, "gray", "e0f4379e4b087c0e78cd7d80564fd8f5179b43190156edb3e3c9d2f2c2d343c1"],
  ["null", yuv, "yuv444p", "e4e66b964c894fd8aca67955e0584a51e6c66c25020c315a9ce616409c6d7748"],
  ["prewitt", impulse, "gray", "bc44fa037f3ebb03255e5ada6277e7cad5315dc5cfff13bec35470908c8b488b"],
  ["prewitt=scale=0.25:delta=16", impulse, "gray", "a72064efc2d45684ff6e4caee42d5348c3cfc25014c54670389d75789d2f5f1e"],
  ["prewitt=planes=2:scale=0.25:delta=16", yuv, "yuv444p", "dfbfec57d55bd049d317fe633acfba0d34ddd63825409d2b4be525133fb83096"]
] as const) {
  it(`matches native ${format} ${filter}`, async () => {
    const result = await run(filter, input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, input.length);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
    if (filter.includes("planes=2")) {
      assert.deepEqual(result.output.subarray(0, 256), input.subarray(0, 256));
      assert.deepEqual(result.output.subarray(512), input.subarray(512));
    }
  });
}

it("supports positional options and disabled frames", async () => {
  const expected = await run("prewitt=planes=2:scale=0.25:delta=16", yuv, "yuv444p");
  const result = await run("prewitt=2:0.25:16", yuv, "yuv444p");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, expected.output);
  for (const filter of ["prewitt=planes=0", "prewitt=enable=0"]) {
    const disabled = await run(filter);
    assert.equal(disabled.exitCode, 0, disabled.stderr);
    assert.deepEqual(disabled.output, impulse);
  }
});

for (const option of ["planes=16", "planes=-1", "scale=-1", "scale=65536", "delta=65536", "delta=-65536", "scale=no", "unknown=1"]) {
  it(`rejects ${option} before replacing output`, async () => {
    const result = await run(`prewitt=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /prewitt/);
    assert.equal(result.output.toString(), "KEEP");
  });
}

it("uses FFmpeg 7 reflected leading and repeated trailing borders", async () => {
  const input = Buffer.from(Array.from({ length: 16 }, (_, i) => i * 10));
  const result = await run("prewitt=scale=0.25:delta=16", input, "gray", "4x4");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual([...result.output], [16, 31, 31, 23, 76, 77, 77, 76, 76, 77, 77, 76, 46, 49, 49, 46]);
});

it("filters subsampled U without changing Y or V", async () => {
  const luma = Buffer.alloc(256, 50);
  const chroma = Buffer.from(Array.from({ length: 64 }, (_, i) => i * 3));
  const input = Buffer.concat([luma, chroma, Buffer.alloc(64, 120)]);
  const result = await run("prewitt=planes=2", input, "yuv420p");
  const gray = await run("prewitt", chroma, "gray", "8x8");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(gray.exitCode, 0, gray.stderr);
  assert.deepEqual(result.output, Buffer.concat([luma, gray.output, input.subarray(320)]));
});

it("accounts for output memory before replacing output", async () => {
  const result = await run("prewitt", impulse, "gray", "16x16", { maxMemoryBytes: 2200 });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /memory/i);
  assert.equal(result.output.toString(), "KEEP");
});
