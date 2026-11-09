import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native libx264 lossless 32x16 YUV420P texture, including non-neutral chroma.
const texture = readFileSync(new URL("fixtures/qp-texture.mp4", import.meta.url));
const pixels = (bytes: Uint8Array) => parseMp4(bytes, { decodeFrames: true }).tracks[0]!.decodedVideoFrames![0]!.native!.pixels;

async function run(qp: string, extra: string[] = [], options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.mp4": texture, "/out.mp4": "keep" });
  const args = ["-y", "-v", "error", "-i", "/in.mp4", "-c:v", "libx264", "-qp", qp, ...extra, "/out.mp4"];
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.mp4") as Buffer };
}

it("preserves every decoded YUV sample with libx264 -qp 0", async () => {
  const result = await run("0");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(pixels(result.output), pixels(texture));
});

it("applies actual lossy quantization for positive QP", async () => {
  const fine = await run("18");
  const coarse = await run("35");
  assert.equal(fine.exitCode, 0, fine.stderr);
  assert.equal(coarse.exitCode, 0, coarse.stderr);
  const source = pixels(texture).subarray(0, 512);
  const error = (output: Uint8Array) => pixels(output).subarray(0, 512)
    .reduce((sum, value, index) => sum + (value - source[index]!) ** 2, 0);
  assert.ok(error(fine.output) > 0);
  assert.ok(error(coarse.output) > error(fine.output));
});

it("does not silently copy input in the synchronous fast path", () => {
  let written = false;
  assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.mp4", "-c:v", "libx264", "-qp", "35", "/out.mp4"], undefined,
    path => path === "/in.mp4" ? texture : undefined,
    () => { written = true; return true; }), undefined);
  assert.equal(written, false);
});

it("keeps stream copy independent of QP", async () => {
  const result = await run("35", ["-c:v", "copy"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(parseMp4(result.output).tracks[0]!.samples.map(sample => sample.data),
    parseMp4(texture).tracks[0]!.samples.map(sample => sample.data));
});

for (const qp of ["bad", "NaN", "Infinity", "-2", "52", ""]) {
  it(`rejects invalid QP ${JSON.stringify(qp)} before replacing output`, async () => {
    const result = await run(qp);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "keep");
  });
}

it("respects disabled video transcoding", async () => {
  const result = await run("35", [], { features: { videoTranscode: false } });
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.output.toString(), "keep");
});

it("combines lossless QP with an explicit encoder preset", async () => {
  const result = await run("0", ["-preset", "medium"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(pixels(result.output), pixels(texture));
});

it("lets explicit QP override a bitrate target", async () => {
  const result = await run("0", ["-b:v", "20k"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(pixels(result.output), pixels(texture));
});

it("does not reuse native pixels after a video filter changes them", async () => {
  const result = await run("0", ["-vf", "hflip"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.notDeepEqual(pixels(result.output), pixels(texture));
});

for (const limits of [{ maxFrames: 0 }, { maxPixelsPerFrame: 511 }, { maxMemoryBytes: 1 }, { maxOutputBytes: 100 }]) {
  it(`enforces encoding limits ${JSON.stringify(limits)}`, async () => {
    const result = await run("35", [], { limits });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "keep");
  });
}
