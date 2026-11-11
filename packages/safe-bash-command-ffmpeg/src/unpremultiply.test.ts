import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const rgba = Buffer.from("4080c0ff4080c0800a141e00ff002040", "hex");

async function run(filter: string) {
  const volume = Volume.fromJSON({ "/in.raw": rgba });
  const output: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2",
      "-framerate", "4", "-i", "in.raw", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", "rgba", "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: Buffer.concat(output) };
}

it("unpremultiplies one RGBA input with native clipping and zero-alpha RGB", async () => {
  const result = await run("unpremultiply=inplace=1");
  assert.equal(result.exitCode, 0, result.stderr);
  // FFmpeg 7.0.2: packed-to-planar conversion also rounds alpha 128 to 129.
  assert.equal(result.output.toString("hex"), "4080c0ff7efdff810a141e00ff007f40");
});

it("keeps the unfiltered RGBA control unchanged", async () => {
  const result = await run("null");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, rgba);
});

for (const [filter, expected] of [
  ["unpremultiply=15:1", "4080c0ff7efdff810a141e00ff007f40"],
  ["unpremultiply=inplace=yes:planes=0", "4080c0ff4080c0810a141e00ff002040"],
  ["unpremultiply=inplace=1:planes=1", "4080c0ff40fdc0810a141e00ff002040"],
  ["unpremultiply=inplace=1:planes=2", "4080c0ff4080ff810a141e00ff007f40"],
  ["unpremultiply=inplace=1:planes=4", "4080c0ff7e80c0810a141e00ff002040"],
  ["unpremultiply=inplace=1:planes=8", "4080c0ff4080c0810a141e00ff002040"],
  ["unpremultiply=inplace=1:enable=0", "4080c0ff4080c0810a141e00ff002040"],
  ["format=gbrap,unpremultiply=inplace=1", "4080c0ff7efdff810a141e00ff007f40"],
  ["unpremultiply=inplace=1,unpremultiply=inplace=1", "4080c0fff9ffff810a141e00ff00ff40"],
] as const) {
  it(`${filter} matches native plane selection and conversion`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}

for (const filter of ["unpremultiply", "unpremultiply=inplace=0", "unpremultiply=inplace=2",
  "unpremultiply=inplace=1:planes=16", "unpremultiply=inplace=1:planes=-1",
  "unpremultiply=inplace=1:unknown=1"]) {
  it(`rejects ${filter} without emitting pixels`, async () => {
    const result = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /unpremultiply/);
    assert.equal(result.output.length, 0);
  });
}
