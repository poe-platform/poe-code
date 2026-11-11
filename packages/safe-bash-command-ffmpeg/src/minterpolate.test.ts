import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = [10, 30, 60, 100, 150, 210];
const grayFrames = (values: readonly number[]) => Buffer.concat(values.map(value => Buffer.alloc(256, value)));

async function run(filter: string, input = grayFrames(source), options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.gray": input, "/out.gray": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "info", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "16x16", "-r", "4",
      "-i", "/in.gray", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", "gray",
      "-bitexact", "-f", "rawvideo", "/out.gray"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.gray"), input);
  return { ...result, stderr, output: volume.readFileSync("/out.gray") };
}

// Complete output bytes from native FFmpeg 7.0.2 for the same raw input and argv.
for (const [filter, expected] of [
  ["minterpolate=fps=6:mi_mode=blend:scd=none", [10, 23, 40, 60, 87, 117, 150]],
  ["minterpolate=fps=6:mi_mode=dup", [10, 30, 30, 60, 100, 100, 150]],
  ["minterpolate=6:blend", [10, 30, 30, 60, 100, 100, 150]],
  ["minterpolate=6:1:scd=0:", [10, 23, 40, 60, 87, 117, 150]],
  ["minterpolate=8:0", [10, 10, 30, 30, 60, 60, 100, 100, 150]],
  ["minterpolate=8:blend:scd=none", [10, 20, 30, 45, 60, 80, 100, 125, 150]],
  ["minterpolate=fps=3/2:mi_mode=blend:scd=none", [10, 87]],
  ["minterpolate=6:blend:scd=fdiff:scd_threshold=0", [10, 30, 30, 60, 100, 100, 150]],
  ["minterpolate=6:blend:scd=fdiff:scd_threshold=100", [10, 23, 40, 60, 87, 117, 150]],
  ["trim=end_frame=1,minterpolate=6:dup", []],
  ["trim=end_frame=2,minterpolate=6:dup", []],
  ["trim=end_frame=3,minterpolate=6:dup", [10, 30]],
  ["setpts=PTS+1,minterpolate=6:blend:scd=none", [17, 30, 50, 73, 100, 133]],
  ["minterpolate=6:blend:scd=none,fps=source_fps", [10, 23, 40, 60, 87, 117, 150, 150, 150]],
  ["fps=6", [10, 10, 30, 60, 60, 100, 150, 150, 210]]
] as const) {
  it(`matches native grayscale ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, grayFrames(expected));
  });
}

for (const [filter, hash] of [
  ["minterpolate=6:blend:scd=none", "a8d8075690261382f792d12e5f8334e88eb852eeda8ffda1c78087a1ab57294a"],
  ["minterpolate=6:dup", "ba3e7ffba04e7a6de68b58d404c09808ab3fa3bf2432f86ff5ff7e72aaf495e0"],
  ["minterpolate=6:blend", "226c6af5e324875f30387765f5eb5161a1b8a96f928090ced9a1263746d6d3ed"]
] as const) {
  it(`matches every native nonuniform sample for ${filter}`, async () => {
    const input = Buffer.from(Array.from({ length: 6 * 256 }, (_, i) => (Math.floor(i / 256) * 37 + i % 256 * 13) % 256));
    const result = await run(filter, input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 1792);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

it("sets output timestamps, durations and frame rate for downstream filters", async () => {
  const result = await run("setpts=PTS+1,minterpolate=6:blend:scd=none,showinfo,select='eq(n,1)+eq(n,5)'");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, grayFrames([30, 133]));
  assert.ok(result.stderr.includes("config in time_base: 1/6, frame_rate: 6/1"), result.stderr);
  const frames = result.stderr.split("\n").filter(line => line.includes("pts_time:"));
  assert.equal(frames.length, 6);
  for (const [index, line] of frames.entries()) {
    const fields = line.split(" ").filter(Boolean);
    assert.equal(fields.find(field => field.startsWith("pts:")), `pts:${index + 2}`, line);
    assert.ok(fields.includes("duration:1"), line);
  }
});

for (const filter of [
  "minterpolate", "minterpolate=6:mci", "minterpolate=0:dup", "minterpolate=6:invalid",
  "minterpolate=6:blend:scd=invalid", "minterpolate=6:blend:scd_threshold=101",
  "minterpolate=6:dup:enable=1", "minterpolate=6:dup:unknown=1",
  "format=rgb24,minterpolate=6:dup"
]) {
  it(`rejects unsupported interpolation without replacing output: ${filter}`, async () => {
    const result = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("minterpolate:"), result.stderr);
    assert.deepEqual(result.output, Buffer.from("KEEP"));
  });
}

it("bounds interpolated frame expansion", async () => {
  const result = await run("minterpolate=1000000:blend:scd=none", grayFrames(source), { limits: { maxFrames: 20 } });
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("maxFrames"), result.stderr);
  assert.deepEqual(result.output, Buffer.from("KEEP"));
});
