import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import type { MediaResourceLimits } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 256 }, (_, i) =>
  35 + 30 * +(i % 16 >= 4) + 100 * +(i % 16 >= 9) + 35 * +(Math.floor(i / 16) >= 8)));
const yuv = Buffer.from(Array.from({ length: 768 }, (_, i) => {
  const p = Math.floor(i / 256), x = i % 16, y = Math.floor(i % 256 / 16);
  return 30 + 12 * p + 35 * +(x >= 3 + p) + 75 * +(y >= 8 - p);
}));

async function run(filter: string, bytes = input, limits?: MediaResourceLimits, format = "gray") {
  const volume = Volume.fromJSON({ "/in.gray": bytes, "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format, "-video_size", "16x16",
      "-framerate", "4", "-i", "/in.gray", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format,
      "-bitexact", "-f", "rawvideo", "/out"],
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

// Complete native FFmpeg 7.0.2 outputs from the reported fixtures.
for (const [filter, bytes, format, hash] of [
  ["sobel", input, "gray", "c8bbe14aed327818d361c72f44ea082df8df84b33be5c6922ae60ca68389ee8d"],
  ["sobel=scale=0.25:delta=16", input, "gray", "ccea6929eff2151f3e1360c65933f7df4d4684d3070bdbd3c3909fc61e63244d"],
  ["sobel=planes=2:scale=0.25:delta=16", yuv, "yuv444p", "f7b3ca7aef0e45dc238c3332e0883f851149c3dfff6960919fb10a5501b4a7b7"]
] as const) {
  it(`matches native ${format} ${filter}`, async () => {
    const result = await run(filter, bytes, undefined, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, bytes.length);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
    if (format === "yuv444p") {
      assert.deepEqual(result.output.subarray(0, 256), bytes.subarray(0, 256));
      assert.deepEqual(result.output.subarray(512), bytes.subarray(512));
    }
  });
}
for (const filter of ["null", "sobel=planes=0"]) {
  it(`preserves input with ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, input);
  });
}

for (const [filter, hash] of [
  ["sobel", "ed9fae7478e0f6815d1f6a6105cbec7e9cebeac36a0ce14104e79635ed2ef052"],
  ["sobel=15:0.25:16", "f3c0fe63f6f28a19f1053f7a85be7c5352e9852f375db2ffb8518c972aa50f51"]
]) {
  it(`matches native borders and rounding for ${filter}`, async () => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 37 + Math.floor(i / 16) * 19) % 256));
    const result = await run(filter!, bytes);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}
it("filters only the enabled frame", async () => {
  const filtered = await run("sobel");
  const result = await run("sobel=enable='eq(n,1)'", Buffer.concat([input, input, input]));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([input, filtered.output, input]));
});
for (const option of ["planes=16", "scale=-1", "delta=65536", "scale=nan", "scale=", "unknown=1"]) {
  it(`rejects invalid ${option} without replacing output`, async () => {
    const result = await run(`sobel=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /sobel/);
    assert.equal(result.output.toString(), "KEEP");
  });
}
it("enforces the memory budget before replacing output", async () => {
  const control = await run("null", input, { maxMemoryBytes: 2048 });
  assert.equal(control.exitCode, 0, control.stderr);
  const result = await run("sobel", input, { maxMemoryBytes: 2048 });
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.output.toString(), "KEEP");
});
