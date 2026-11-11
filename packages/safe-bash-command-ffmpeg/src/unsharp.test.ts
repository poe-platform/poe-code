import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import type { MediaResourceLimits } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 32 * 32 }, (_, i) =>
  (i % 32 < 16 ? 55 : 170) + (i % 32 + 2 * Math.floor(i / 32)) % 7));

async function run(filter: string, bytes = input, limits?: MediaResourceLimits) {
  const volume = Volume.fromJSON({ "/in.gray": bytes, "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "32x32",
      "-framerate", "4", "-i", "/in.gray", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", "gray",
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

// FFmpeg 7.0.2 reference hashes include every pixel and replicated borders.
for (const [amount, hash, first] of [
  [1, "d78feca38cf5e6e1559184a56298d42de2da2b4ad73c477f581339c657522f74", 54],
  [-1, "7dac08fe237ea1fe2ad0f9638f04467c821143dda778185aaa56e956bc83ec1c", 56]
] as const) {
  it(`matches native grayscale unsharp=5:5:${amount}`, async () => {
    const result = await run(`unsharp=5:5:${amount}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, input.length);
    assert.equal(result.output[0], first);
    assert.equal(result.output.filter((value, i) => value !== input[i]).length, 886);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

for (const [options, hash] of [
  ["3:7:0.333333", "d1e87d4e5f18b7942bf3b078cc5d3e0a283c397f905a023bd65c945ece1a7cc5"],
  ["7:3:-0.333333", "49198fc2bb2efd9036673509237038236b85951ec57f3dad84af26f18820bdfc"],
  ["23:3:1", "d1b0d7bf6b784483f6f73f15d83b5f7d85e5b72a2f7be156f5481743a57b05f7"],
  ["3:3:5", "d4d2196c613c31f40f41e04a6452a66fa75591ef2bb76404c1cd54e5d414333f"],
  ["3:3:-2", "3d72fe27abd642fccf2e33f6cb4320612ae1bb0f2f7db76ddc31f6a0a1b2e756"],
  ["5:5:1/65536", "a892c8ca16604b7d23f78d815e59679decde6f3c99c5c90f5d24e8b5cd527635"]
] as const) {
  it(`matches native rounding, borders and clipping for unsharp=${options}`, async () => {
    const result = await run(`unsharp=${options}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

for (const filter of ["null", "unsharp=5:5:0", "unsharp=5:5:0.00001", "unsharp=enable=0", "unsharp=enable=NAN"]) {
  it(`preserves grayscale input for ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, input);
  });
}

for (const filter of ["unsharp", "unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=1", "unsharp=lx=10/2:ly=5:la=1:"]) {
  it(`accepts defaults, named luma options and expressions: ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(createHash("sha256").update(result.output).digest("hex"),
      "d78feca38cf5e6e1559184a56298d42de2da2b4ad73c477f581339c657522f74");
  });
}

it("enables unsharp at the selected timestamp and preserves frame order", async () => {
  const sharpened = await run("unsharp");
  const result = await run("unsharp=enable='eq(t,0.25)'", Buffer.concat([input, input, input]));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([input, sharpened.output, input]));
});

for (const option of ["lx=2", "ly=4", "lx=24", "lx=23:ly=5", "la=-3", "la=6", "la=nan", "lx=", "unknown=1"]) {
  it(`rejects invalid unsharp ${option} without replacing output`, async () => {
    const result = await run(`unsharp=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("unsharp"), result.stderr);
    assert.equal(result.output.toString(), "KEEP");
  });
}

it("enforces the memory limit without replacing output", async () => {
  const control = await run("null", input, { maxMemoryBytes: 8192 });
  assert.equal(control.exitCode, 0, control.stderr);
  const result = await run("unsharp", input, { maxMemoryBytes: 8192 });
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.output.toString(), "KEEP");
});
