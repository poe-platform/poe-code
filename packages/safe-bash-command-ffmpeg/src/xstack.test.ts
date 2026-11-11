import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, options: Parameters<typeof createFfmpegCommand>[0] = {}, output = "pipe:1") {
  const volume = Volume.fromJSON({
    "/a.raw": Buffer.from([1, 2, 3, 4, 10, 20, 30, 40]),
    "/b.raw": Buffer.from([5, 6, 7, 8]),
    "/out.raw": "existing output"
  });
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand(options).execute({
    args: ["-y", "-v", "error",
      "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-r", "1", "-i", "/a.raw",
      "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-r", "1", "-i", "/b.raw",
      "-filter_complex", `${filter}[out]`, "-map", "[out]", "-pix_fmt", "gray", "-f", "rawvideo", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
  } as never);
  return { ...result, volume, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

for (const [filter, expected] of [
  ["xstack", "01020506030407080a1405061e280708"],
  ["xstack=layout=0_0|w0_0", "01020506030407080a1405061e280708"],
  ["xstack=grid=2x1", "01020506030407080a1405061e280708"],
  ["xstack=2:0_0|w0+1_0::1:white", "0102ff05060304ff0708"],
  ["xstack=grid=1x2", "01020304050607080a141e2805060708"],
  ["xstack=layout=0_0|w0+1_0:fill=white", "0102ff05060304ff07080a14ff05061e28ff0708"],
  ["xstack=layout=0_0|w0+1_0:fill=white:shortest=1", "0102ff05060304ff0708"],
  ["xstack=layout=0_0|0_h0+1:fill=white", "01020304ffff050607080a141e28ffff05060708"],
  ["xstack=layout=w1_0|0_0", "050601020708030405060a1407081e28"],
  ["xstack=layout=0_0|w0+1_0:fill=0x808080:shortest=1", "01028005060304800708"]
]) {
  it(`renders two direct inputs with ${filter}`, async () => {
    const result = await run(`[0:v][1:v]${filter}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString("hex"), expected);
  });
}

it("uses stack pad order for coordinates and repeats the shorter first input", async () => {
  const result = await run("[1:v][0:v]xstack=layout=0_0|w0+1_0:fill=white");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString("hex"), "0506ff01020708ff03040506ff0a140708ff1e28");
});

for (const option of ["layout=0_0", "layout=0_0|w2_0", "layout=0_0|-1_0", "grid=2x2",
  "shortest=invalid", "fill=invalid", "inputs=3", "unknown=1", "layout=0_0|w0_0:grid=1x2", "layout=0_0|1e30_0"]) {
  it(`rejects invalid xstack ${option} without emitting pixels`, async () => {
    const result = await run(`[0:v][1:v]xstack=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("xstack") || result.stderr.includes("Invalid color"), result.stderr);
    assert.equal(result.stdout.length, 0);
  });
}

it("preserves existing output on an invalid layout", async () => {
  const result = await run("[0:v][1:v]xstack=layout=0_0|w2_0", {}, "/out.raw");
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.volume.readFileSync("/out.raw", "utf8"), "existing output");
});

it("enforces the frame pixel budget on the complete canvas before allocating it", async () => {
  const result = await run("[0:v][1:v]xstack=layout=0_0|w0+1_0:fill=white", {
    limits: { maxPixelsPerFrame: 8 }
  });
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("maxPixelsPerFrame"), result.stderr);
  assert.equal(result.stdout.length, 0);
});
