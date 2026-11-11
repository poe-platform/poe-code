import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, input = "101a242e38424c56606a747e", format = "yuv444p", size = "2x2",
  outputArgs: string[] = ["-pix_fmt", "gray"], options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex"), "/out.raw": "keep" });
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format, "-video_size", size,
      "-i", "/in.raw", "-vf", filter, ...outputArgs, "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") };
}

// Native Linux FFmpeg 7.0.2-static: source samples, without limited-range expansion.
for (const [plane, expected] of [["y", "101a242e"], ["u", "38424c56"], ["v", "606a747e"]]) {
  it(`extracts the original ${plane} plane through the public command`, async () => {
    const result = await run(`extractplanes=${plane}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}

it("keeps ordinary grayscale conversion unchanged", async () => {
  const result = await run("null");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.toString("hex"), "000c1723");
});

it("accepts the named plane option and infers grayscale output", async () => {
  const result = await run("extractplanes=planes=u", undefined, undefined, undefined, []);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.toString("hex"), "38424c56");
});

for (const [format, input, expected] of [
  ["yuv420p", "101a242e38424c5660606a747e808a949e", "606a747e"],
  ["yuv422p", "101a242e38424c5660606a747e808a909aa4aeb4bec8d2", "606a747e808a"]
]) {
  it(`extracts subsampled ${format} chroma at its own odd-sized dimensions`, async () => {
    const result = await run("extractplanes=u", input, format, "3x3");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}

it("preserves multiple frames and passes extracted pixels to downstream filters", async () => {
  const result = await run("extractplanes=u,hflip", "101a242e38424c56606a747e101a242e0001feff606a747e");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.toString("hex"), "4238564c0100fffe");
});

for (const filter of ["extractplanes=u+v", "extractplanes=bogus", "extractplanes=u:bogus=1", "extractplanes=u:v"]) {
  it(`rejects ${filter} before replacing the output`, async () => {
    const result = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /extractplanes/);
    assert.equal(result.output.toString(), "keep");
  });
}

it("checks output limits before replacing the destination", async () => {
  const result = await run("extractplanes=u", undefined, undefined, undefined, undefined,
    { limits: { maxOutputBytes: 3 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.output.toString(), "keep");
});

for (const [format, filter] of [["rgb24", "extractplanes=y"], ["yuv444p", "format=rgb24,extractplanes=u"]]) {
  it(`rejects unavailable YUV planes after ${format} / ${filter}`, async () => {
    const result = await run(filter!, undefined, format);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /extractplanes: requires retained 8-bit planar YUV input/);
    assert.equal(result.output.toString(), "keep");
  });
}
