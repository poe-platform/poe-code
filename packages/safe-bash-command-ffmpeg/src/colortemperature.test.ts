import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = "0c121c3440488080804182beb48755d7dce1f0a050fcfaf6";

async function render(filter: string, input = source, destination = "pipe:1", pixelFormat = "rgb24") {
  const volume = Volume.fromJSON({ "/out.raw": "existing output" });
  volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", pixelFormat, "-video_size", "4x2", "-framerate", "4", "-i", "/in.raw",
      "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", pixelFormat, "-bitexact", "-f", "rawvideo", destination],
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

// Complete raw RGB frames from native FFmpeg 7.0.2.
for (const [filter, expected] of [
  ["null", source],
  ["colortemperature", "0c111b343f46807f7d4181bab48653d7dbdcf09f4efcf9f1"],
  ["colortemperature=temperature=6500", "0c111b343f46807f7d4181bab48653d7dbdcf09f4efcf9f1"],
  ["colortemperature=temperature=6400/2:mix=1:pl=0", "0c0c0d342e22805c3d415d5bb46129d79e6cf07326fcb476"],
  ["colortemperature=temperature=3200", "0c0c0d342e22805c3d415d5bb46129d79e6cf07326fcb476"],
  ["colortemperature=temperature=9500:mix=0.6:pl=0.4", "0a101c2e3b497378833a78c0a48057c2cee6dc9853e4ebfc"],
  ["colortemperature=9500:0.6:0.4", "0a101c2e3b497378833a78c0a48057c2cee6dc9853e4ebfc"],
  ["colortemperature=mix=0", source],
  ["colortemperature=enable=0", source]
] as const) {
  it(`matches native RGB bytes for ${filter}`, async () => {
    const result = await render(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString("hex"), expected);
  });
}

it("filters each frame when writing to a file", async () => {
  const result = await render("colortemperature=3200", source.repeat(2), "/out.raw");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.volume.readFileSync("/out.raw").toString("hex"), "0c0c0d342e22805c3d415d5bb46129d79e6cf07326fcb476".repeat(2));
});

for (const option of ["temperature=999", "temperature=40001", "mix=-0.1", "mix=1.1", "pl=-0.1", "pl=1.1", "temperature=NaN", "mix=1/0", "pl=", "unknown=1"]) {
  it(`rejects ${option} without replacing existing output`, async () => {
    const result = await render(`colortemperature=${option}`, source, "/out.raw");
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("colortemperature"));
    assert.equal(result.volume.readFileSync("/out.raw").toString(), "existing output");
    assert.equal(result.stdout.length, 0);
  });
}

it("preserves alpha, including color under transparent pixels", async () => {
  const input = Buffer.from(source, "hex");
  const expected = Buffer.from("0c0c0d342e22805c3d415d5bb46129d79e6cf07326fcb476", "hex");
  const rgba = Buffer.alloc(32);
  const output = Buffer.alloc(32);
  for (let pixel = 0; pixel < 8; pixel++) {
    input.copy(rgba, pixel * 4, pixel * 3, pixel * 3 + 3);
    expected.copy(output, pixel * 4, pixel * 3, pixel * 3 + 3);
    rgba[pixel * 4 + 3] = output[pixel * 4 + 3] = pixel * 32;
  }
  const result = await render("colortemperature=3200", rgba.toString("hex"), "pipe:1", "rgba");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, output);
});

it("selects frames by timeline without changing the bypassed frame", async () => {
  const result = await render("colortemperature=3200:enable='gte(n,1)'", source.repeat(2));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString("hex"), source + "0c0c0d342e22805c3d415d5bb46129d79e6cf07326fcb476");
});
