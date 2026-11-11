import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from("4080c0ff4080c0800a141e00ff002040", "hex");

async function run(filter: string, bytes = input, size = "2x2") {
  const volume = Volume.fromJSON({ "/in.raw": bytes, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", size,
      "-framerate", "4", "-i", "/in.raw", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", "rgba", "-bitexact", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), bytes);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

// Exact outputs from FFmpeg 7.0.2-static with the same input bytes and arguments.
for (const [filter, expected] of [
  ["null", "4080c0ff4080c0800a141e00ff002040"],
  ["premultiply=inplace=1", "4080c0ff204161810000000040000840"],
  ["premultiply=15:1", "4080c0ff204161810000000040000840"],
  ["premultiply=inplace=true", "4080c0ff204161810000000040000840"],
  ["premultiply=inplace=1:planes=0", "4080c0ff4080c0810a141e00ff002040"],
  ["premultiply=inplace=1:planes=1", "4080c0ff4041c0810a001e00ff002040"],
  ["premultiply=inplace=1:planes=2", "4080c0ff408061810a140000ff000840"],
  ["premultiply=inplace=1:planes=4", "4080c0ff2080c08100141e0040002040"],
  ["premultiply=inplace=1:planes=8", "4080c0ff4080c0810a141e00ff002040"],
  ["format=gbrap,premultiply=inplace=1", "4080c0ff204161810000000040000840"],
  ["premultiply=inplace=1,premultiply=inplace=1", "4080c0ff102131810000000010000240"],
  ["premultiply=inplace=1:enable=0", "4080c0ff4080c0810a141e00ff002040"],
  ["premultiply=inplace=1:enable=1", "4080c0ff204161810000000040000840"]
]) {
  it(`matches native RGBA bytes for ${filter}`, async () => {
    const result = await run(filter!);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}

it("preserves frame order and evaluates the timeline at input timestamps", async () => {
  const result = await run("premultiply=inplace=1:enable=gte(t\\,0.25)", Buffer.concat([input, input]));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.toString("hex"), "4080c0ff4080c0810a141e00ff0020404080c0ff204161810000000040000840");
});

it("matches native rounding across every 8-bit opacity", async () => {
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, alpha) => [1, 127, 254, alpha]).flat());
  const result = await run("premultiply=inplace=1", bytes, "256x1");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(createHash("sha256").update(result.output).digest("hex"), "94421b9c2e4ac9b946600777c933b4538bf5a8c0b587ed0dfe4d378827436a5f");
});

for (const filter of ["premultiply", "premultiply=inplace=0", "premultiply=inplace=2",
  "premultiply=inplace=1:planes=16", "premultiply=inplace=1:planes=-1", "premultiply=inplace=1:bogus=1"]) {
  it(`rejects ${filter} without replacing output`, async () => {
    const result = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /premultiply/);
    assert.equal(result.output.toString(), "KEEP");
  });
}
