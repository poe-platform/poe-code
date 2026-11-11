import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = "4080c0ff4080c0800a141e00ff002040";

async function render(filter: string, input = source, destination = "pipe:1") {
  const volume = Volume.fromJSON({ "/out.raw": "existing output" });
  volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2", "-framerate", "4", "-i", "/in.raw",
      "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-bitexact", "-f", "rawvideo", destination],
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
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString(), volume };
}

// Exact native FFmpeg 7.0.2 RGBA output, including invisible RGB samples.
for (const [filter, expected] of [
  ["null", source],
  ["colorchannelmixer", source],
  ["colorchannelmixer=aa=0.5", "4080c0804080c0400a141e00ff002020"],
  ["colorchannelmixer=rr=0:rb=1:br=1:bb=0", "c08040ffc08040801e140a002000ff40"],
  ["colorchannelmixer=0:0:1:0:0:1:0:0:1:0:0", "c08040ffc08040801e140a002000ff40"],
  ["colorchannelmixer=rr=2:rg=-1:ar=1:aa=0", "0080c0400080c04000141e0aff0020ff"],
  ["colorchannelmixer=rr=0:ra=1:gg=0:gr=1:bb=0:bg=1:aa=0:ab=1", "ff4080c0804080c0000a141e40ff0020"],
  ["colorchannelmixer=aa=1/2, colorchannelmixer=aa=2", "4080c0ff4080c0800a141e00ff002040"]
] as const) {
  it(`matches native RGBA bytes for ${filter}`, async () => {
    const result = await render(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString("hex"), expected);
  });
}

it("rounds each coefficient contribution to nearest even before summing", async () => {
  const result = await render("colorchannelmixer=rr=0.5:rg=0.5:gg=0.5:bb=0.5:aa=0.5", "01010101030303030505050507070707");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString("hex"), "00000000040202020402020208040404");
});

it("mixes each frame and writes the resulting bytes to a file", async () => {
  const result = await render("colorchannelmixer=aa=0.5", source.repeat(2), "/out.raw");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.volume.readFileSync("/out.raw").toString("hex"), "4080c0804080c0400a141e00ff002020".repeat(2));
});

for (const option of ["rr=2.01", "aa=-2.01", "rg=NaN", "bb=1/0", "rr=", "unknown=1", "pc=lum"]) {
  it(`rejects ${option} without replacing existing output`, async () => {
    const result = await render(`colorchannelmixer=${option}`, source, "/out.raw");
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /colorchannelmixer/);
    assert.equal(result.volume.readFileSync("/out.raw").toString(), "existing output");
    assert.equal(result.stdout.length, 0);
  });
}
