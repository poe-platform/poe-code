import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(options: string) {
  const input = Buffer.concat([
    Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
    ...[16, 235, 16, 235, 235, 16, 235].flatMap(y => [
      Buffer.from("FRAME\n"), Buffer.alloc(4, y), Buffer.alloc(8, 128)
    ])
  ]);
  const fs = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", `tile=${options}`,
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.raw") as Buffer };
}

for (const [options, bytes, hash] of [
  ["padding=1+1", 180, "b2e6af48427ad7da2684acfcef97e2499d3391b109bc6c9e386231702c208ed2"],
  ["padding=2", 180, "b2e6af48427ad7da2684acfcef97e2499d3391b109bc6c9e386231702c208ed2"],
  ["margin=0.5", 108, "bc857ecd5697747f39ecc3ee92bf8899a3cf7277e12737cd222534cb7663ea38"],
  ["margin=0", 108, "bc857ecd5697747f39ecc3ee92bf8899a3cf7277e12737cd222534cb7663ea38"]
] as const) {
  it(`matches native tile=3x1:${options} bytes`, async () => {
    const { result, stderr, output } = await run(`3x1:${options}`);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output.length, bytes);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

for (const key of ["nb_frames", "margin", "padding", "overlap", "init_padding"]) {
  for (const [expression, integer] of [
    ["1+1", "2"], ["0.5", "0"], ["0.5001", "1"], ["1.5", "2"],
    ["2.5", "2"], ["3.5", "4"], ["PI", "3"], ["default", "0"], ["min", "0"]
  ]) {
    it(`tile evaluates ${key}=${expression} as ${integer}`, async () => {
      const expected = await run(`4x1:${key}=${integer}`);
      const actual = await run(`4x1:${key}=${expression}`);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.output, expected.output);
    });
  }
  const max = key === "margin" || key === "padding" ? 1024 : 2147483647;
  for (const expression of ["", "bad", "1+", "1/0", "0/0", "-0.1", `${max}+0.1`]) {
    it(`tile rejects ${key}=${expression} before replacing output`, async () => {
      const { result, stderr, output } = await run(`4x1:${key}=${expression}`);
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes(`tile: ${key}`), stderr);
      assert.equal(output.toString(), "KEEP");
    });
  }
}

it("tile checks the rounded frame count against grid capacity", async () => {
  const expected = await run("3x1:nb_frames=3");
  const actual = await run("3x1:nb_frames=3.1");
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.deepEqual(actual.output, expected.output);
  const invalid = await run("3x1:nb_frames=3.5");
  assert.notEqual(invalid.result.exitCode, 0);
  assert.equal(invalid.output.toString(), "KEEP");
});

it("tile evaluates positional numeric options", async () => {
  const expected = await run("3x1:2:0:2:black:1:1");
  const actual = await run("3x1:1+1:0.5:2.5:black:0.6:1.4");
  assert.equal(expected.result.exitCode, 0, expected.stderr);
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.deepEqual(actual.output, expected.output);
});
