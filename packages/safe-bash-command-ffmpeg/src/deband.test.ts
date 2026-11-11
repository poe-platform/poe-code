import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import type { MediaResourceLimits } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 1024 }, (_, i) => 96 + 2 * Math.floor((i % 32) / 3) + Math.floor(Math.floor(i / 32) / 8)));
async function run(filter: string, format = "rawvideo", limits?: MediaResourceLimits, source = input, size = "32x32", graph = false) {
  const volume = Volume.fromJSON({ "/in.gray": source, "/out": "KEEP" });
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", size, "-r", "4", "-i", "/in.gray",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[o]`, "-map", "[o]"] : ["-vf", filter]), "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", format, "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { ...result, output: volume.readFileSync("/out") as Buffer, stderr: Buffer.concat(errors).toString() };
}

// Native FFmpeg 7.0.2 hashes cover every pixel, including clipped borders.
for (const [filter, hash, changes] of [
  ["null", "25cd9a3386feaefe47a71ba1cbb93062f87ee134379b43590b0ee75f6efc3060", 0],
  ["deband=r=-3:d=-1:1thr=0.1", "6846e7b966485c644d1eb70766b9888dd2b18f280daf059612feea317892579b", 652],
  ["deband=r=-3:d=-1:1thr=0.001", "25cd9a3386feaefe47a71ba1cbb93062f87ee134379b43590b0ee75f6efc3060", 0],
  ["deband=r=-3:d=-0.01:1thr=0.1", "449eaf2f14fbc637f601498ebfc5b1199012c03c00817122c6eca010ef4c718f", 704],
  ["deband=0.1:0.02:0.02:0.02:-3:-1", "6846e7b966485c644d1eb70766b9888dd2b18f280daf059612feea317892579b", 652],
  ["deband=range=-3:direction=-1:1thr=0.1:blur=0", "6846e7b966485c644d1eb70766b9888dd2b18f280daf059612feea317892579b", 652],
] as const) {
  it(`matches native grayscale ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, input.length);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
    assert.equal(result.output.filter((value, i) => value !== input[i]).length, changes);
  });
}

for (const options of ["1thr=0", "1thr=0.6", "r=-2147483649", "r=2147483647.1", "d=-7", "b=wrong", "c=wrong", "unknown=1"]) {
  it(`rejects invalid or unsupported deband ${options} without replacing output`, async () => {
    const result = await run(`deband=r=-3:d=-1:${options}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "KEEP");
  });
}

it("enforces the memory budget without replacing output", async () => {
  const result = await run("deband=r=-3:d=-1:1thr=0.1", "rawvideo", { maxMemoryBytes: 4096 });
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.output.toString(), "KEEP");
});

const samplingInput = Buffer.from(Array.from({ length: 256 }, (_, i) =>
  96 + 2 * Math.floor((i % 16) / 3) + Math.floor(Math.floor(i / 16) / 4)));

for (const [filter, hash, changes] of [
  ["deband", "cafd3dbba252b0d3e2236abfb19414dd5bd3585d60ae5f3645a8cf897296f32c", 158],
  ["deband=r=3:d=-1", "280246faf0de6d8def95ad19a8793e7953c24773659b6411723e435ac1049569", 51],
  ["deband=r=-3:d=1", "0d53a50dfe32a50145f35052834634d223ea197fe2fd80f36dcc1d6d0a2c7c27", 176],
  ["deband=r=-3:d=-1:1thr=0.1", "55f93c19c04617cdbb09c1d2d63e7dc728400a2a65ae0d967f5a4c500e6c6a41", 166],
  ["deband=r=-2.6:d=-1:1thr=0.1", "55f93c19c04617cdbb09c1d2d63e7dc728400a2a65ae0d967f5a4c500e6c6a41", 166],
] as const) {
  it(`matches native sampling for ${filter} across repeated frames`, async () => {
    const result = await run(filter, "rawvideo", undefined, Buffer.concat([samplingInput, samplingInput]), "16x16");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 512);
    for (let start = 0; start < result.output.length; start += 256) {
      const frame = result.output.subarray(start, start + 256);
      assert.equal(createHash("sha256").update(frame).digest("hex"), hash);
      assert.equal(frame.filter((value, i) => value !== samplingInput[i]).length, changes);
    }
  });
}

for (const filter of ["deband=r=0", "deband=r=-3:d=0"]) {
  it(`accepts zero sampling controls for ${filter}`, async () => {
    const result = await run(filter, "rawvideo", undefined, samplingInput, "16x16");
    assert.equal(result.exitCode, 0, result.stderr);
    if (filter === "deband=r=0") assert.deepEqual(result.output, samplingInput);
    else {
      const horizontal = await run("deband=r=-3:d=-0.000001", "rawvideo", undefined, samplingInput, "16x16");
      assert.equal(horizontal.exitCode, 0, horizontal.stderr);
      assert.deepEqual(result.output, horizontal.output);
    }
  });
}

for (const [fraction, integer] of [[-2.6, -3], [-2.5, -2], [-3.5, -4], [2.5, 2], [3.5, 4]] as const) {
  for (const range of [`r=${fraction}`, `range=${fraction}`,
    `0.1:0.02:0.02:0.02:${fraction}:-1`]) {
    it(`rounds deband range ${range} like native FFmpeg`, async () => {
      const result = await run(`deband=${range}:d=-1:1thr=0.1`);
      const control = await run(`deband=r=${integer}:d=-1:1thr=0.1`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(control.exitCode, 0, control.stderr);
      assert.deepEqual(result.output, control.output);
    });
  }
}

for (const graph of [false, true]) {
  for (const enable of ["gte(n,1)", "gte(t,0.25)", "gte(st(0,ld(0)+1),4)"]) {
    it(`deband honors timeline ${enable} (graph ${graph})`, async () => {
      const source = Buffer.concat([samplingInput, samplingInput, samplingInput]);
      const result = await run(`deband=r=-3:d=-1:1thr=0.1:enable='${enable}'`, "rawvideo", undefined, source, "16x16", graph);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.length, 768);
      assert.deepEqual(result.output.subarray(0, 256), samplingInput);
      assert.equal(createHash("sha256").update(result.output).digest("hex"), "c17f2b7e01065af573a9c1c2df4cdcf36de276f9299140a84996b9d7744d71e6");
    });
  }
  for (const enable of ["0", "NAN", "lt(n,0)", "st(0,not(ld(0)))"]) {
    it(`deband bypasses disabled frames for ${enable} (graph ${graph})`, async () => {
      const source = Buffer.concat([samplingInput, samplingInput, samplingInput]);
      const result = await run(`deband=r=-3:d=-1:1thr=0.1:enable='${enable}'`, "rawvideo", undefined, source, "16x16", graph);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, source);
    });
  }
  it(`rejects invalid deband timeline without replacing output (graph ${graph})`, async () => {
    const result = await run("deband=enable=unknown", "rawvideo", undefined, samplingInput, "16x16", graph);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "KEEP");
  });
}
