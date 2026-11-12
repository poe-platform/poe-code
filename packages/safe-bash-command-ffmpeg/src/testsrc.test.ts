import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const duration of [0.5, 0.51, 0.6, 0.75, 1]) {
  it(`keeps testsrc frames starting before ${duration} seconds`, async () => {
    const volume = Volume.fromJSON({});
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
        `testsrc=s=16x8:r=2:d=${duration}`, "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const bytes = Buffer.concat(output);
    assert.equal(bytes.length, duration === 0.5 ? 384 : 768);
    // Native FFmpeg 7.0.2 RGB24 output.
    assert.equal(createHash("sha256").update(bytes).digest("hex"), duration === 0.5
      ? "29a11cf4feef25fd4455278ef894089ee4ed0c07468690ed0121990ed726fad6"
      : "6c6778ead7b02dfed9193c8389e6c29026a862b2a5a71e468e56b764f9d7be4d");
  });
}

for (const option of ["d", "duration"]) {
  for (const duration of ["1ms", "1000us", "0.001", "1s", "1", "1000ms"]) {
    it(`matches native testsrc RGB24 bytes for ${option}=${duration}`, async () => {
      const volume = Volume.fromJSON({});
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
          `testsrc=s=16x8:r=2:${option}=${duration}`, "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const bytes = Buffer.concat(output);
      const short = ["1ms", "1000us", "0.001"].includes(duration);
      assert.equal(bytes.length, (short ? 1 : 2) * 16 * 8 * 3);
      // Native FFmpeg 7.0.2 output: one frame for 1ms, two for 1s.
      assert.equal(createHash("sha256").update(bytes).digest("hex"), short
        ? "29a11cf4feef25fd4455278ef894089ee4ed0c07468690ed0121990ed726fad6"
        : "6c6778ead7b02dfed9193c8389e6c29026a862b2a5a71e468e56b764f9d7be4d");
    });
  }
}

// Native FFmpeg RGB24 frame hashes, including the time counter at one second.
for (const [size, hashes] of [
  ["96x64", ["ed0ad8b07c429cb7190234c536146ded", "f07a549b054d4bba1f81fe8b871fb4a9", "55aac09e1cce1f5eb62b8fca4aa04da2", "2b0968ba31e7eb5eba62fcb1c54028a1"]],
  ["8x8", ["d6cf6590d08ff5d5af0c436adcc2186b", "abb05080dabc279c59077db57a92525d", "833a67795dc6901240cd2416aca3c1d0", "d6dfa6447773f72466e8870b3ffb830a"]],
  ["97x65", ["1ee5c5564c391dca2fc97348d45f925c", "6e80f442a1d56a985f018e319e5b21b0", "e8cc7e04262721601879202a6a4498cd", "b441e822f9f6eafedd0513162e7fedc0"]],
  ["320x240", ["3d3fbccf770a51f9d81725d4e0539f83", "bb8fd6ca2a3c3e4ee214b54af036a091", "7ff7540818811f242163860d916ae65c", "970916bb374553737f04661cdbb8a878"]]
] as const) {
  it(`renders native testsrc pixels in numbered PNGs at ${size}`, async () => {
    const volume = Volume.fromJSON({});
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc=size=${size}:rate=2:duration=2`, "o%d.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.deepEqual(volume.readdirSync("/"), ["o1.png", "o2.png", "o3.png", "o4.png"]);
    for (const [index, hash] of hashes.entries()) {
      const image = decodeImage(new Uint8Array(volume.readFileSync(`/o${index + 1}.png`) as Uint8Array));
      assert.equal(`${image.width}x${image.height}`, size);
      const rgb = image.data.filter((_, offset) => offset % 4 !== 3);
      assert.equal(createHash("md5").update(rgb).digest("hex"), hash, `frame ${index}`);
    }
  });
}

// Native FFmpeg 7.0.2 RGB24 outputs for two seconds at each frame rate.
for (const option of ["r", "rate"]) {
  for (const [rate, frames, hash] of [
    ["3/2", 3, "e6a3aa9c72b5a7062c0c162826636e26f31c3c78b4c9274f416be93d5b9859a3"],
    ["1.5", 3, "e6a3aa9c72b5a7062c0c162826636e26f31c3c78b4c9274f416be93d5b9859a3"],
    ["3/1", 6, "2a19205bbbacf75d2b0d60fce618d96704da52fee49628214086dcd2c6548bcb"],
    ["3", 6, "2a19205bbbacf75d2b0d60fce618d96704da52fee49628214086dcd2c6548bcb"]
  ] as const) {
    it(`renders native testsrc raw frames with ${option}=${rate}`, async () => {
      const volume = Volume.fromJSON({});
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
          `testsrc=s=16x8:${option}=${rate}:d=2`, "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
      assert.equal(Buffer.concat(stderr).toString(), "");
      const output = Buffer.concat(stdout);
      assert.equal(output.length, frames * 16 * 8 * 3);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
