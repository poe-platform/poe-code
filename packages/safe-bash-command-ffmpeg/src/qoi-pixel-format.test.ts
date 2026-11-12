import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Two colored RGBA pixels, the first partially transparent.
const input = Buffer.from("716f696600000002000000010400ff80402080ff1248aaff0000000000000001", "hex");

for (const format of ["gray", "gray8", "gray16be", "rgb48be", "yuv420p"]) {
  for (const [name, outputArgs, output] of [
    ["file", ["/out.qoi"], "/out.qoi"],
    ["sequence", ["/out%d.qoi"], "/out1.qoi"],
    ["explicit encoder", ["-c:v", "qoi", "-f", "image2", "/out.png"], "/out.png"],
    ["pipe", ["-c:v", "qoi", "-f", "image2pipe", "pipe:1"], "pipe:1"]
  ] as const) {
    it(`negotiates RGB for QOI ${name} with -pix_fmt ${format}`, async () => {
      const volume = Volume.fromJSON({ "/in.qoi": input });
      const chunks: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.qoi", "-pix_fmt", format, ...outputArgs],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const bytes = output === "pipe:1" ? Buffer.concat(chunks) : volume.readFileSync(output) as Buffer;
      assert.equal(bytes[12], 3);
      assert.equal(bytes.subarray(14, -8).toString("hex"), "fe804020fe1248aa");
      assert.equal(Buffer.from(decodeImage(bytes).data).toString("hex"), "804020ff1248aaff");
    });
  }

  it(`defers synchronous -pix_fmt ${format} to the asynchronous command`, () => {
    let writes = 0;
    const result = evalSyncFfmpeg(["-y", "-i", "/in.qoi", "-pix_fmt", format, "/out%d.qoi"], undefined,
      () => input,
      () => { writes++; return true; });
    assert.equal(writes, 0, "must defer before writing output");
    assert.equal(result, undefined);
  });
}

for (const [name, options, output, expected] of [
  ["explicit grayscale filter", ["-vf", "format=gray", "-pix_fmt", "gray"], "/out.qoi", "4f4f4fff434343ff"],
  ["explicit RGB filter", ["-vf", "format=rgb24"], "/out.qoi", "804020ff1248aaff"],
  ["PNG encoder override", ["-c:v", "png", "-pix_fmt", "gray"], "/out.qoi", "4f4f4fff434343ff"]
] as const) {
  it(`preserves ${name}`, async () => {
    const volume = Volume.fromJSON({ "/in.qoi": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.qoi", ...options, output],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(Buffer.from(decodeImage(volume.readFileSync(output) as Buffer).data).toString("hex"), expected);
  });
}

for (const target of ["/out.qoi", "/out%d.qoi", "pipe:1", "/out.bin"]) {
  for (const explicitFilter of [false, true]) {
    it(`preserves QOI color and alpha with ${explicitFilter ? "format=ya8" : "-pix_fmt ya8"} (${target})`, async () => {
      const pixels = Buffer.from("003b76b117528dc82e69a4df4580bbf62f6aa5e04681bcf75d98d30e74afea25", "hex");
      const volume = Volume.fromJSON({ "/in.raw": pixels });
      const chunks: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "4x2",
          "-i", "/in.raw", "-frames:v", "1", ...(explicitFilter ? ["-vf", "format=ya8"] : ["-pix_fmt", "ya8"]),
          "-c:v", "qoi", "-f", target === "pipe:1" ? "image2pipe" : "image2", target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const encoded = target === "pipe:1" ? Buffer.concat(chunks) : volume.readFileSync(target.replace("%d", "1")) as Buffer;
      assert.equal(encoded[12], 4, "QOI RGBA channel header");
      // Native FFmpeg 7.0.2: only an explicit filter converts the source to grayscale.
      assert.equal(Buffer.from(decodeImage(encoded).data).toString("hex"), explicitFilter
        ? "303030b2474747c95e5e5ee0757575f75f5f5fe1767676f88d8d8d0ea4a4a425"
        : pixels.toString("hex"));
    });
  }
}

// FFmpeg 7.0.2: unsupported non-alpha formats select RGB without changing colors.
for (const format of ["gray16be", "rgb48be", "yuv420p", "gray", "rgb24", "rgba"]) {
  it(`matches native QOI bytes and pixels from raw RGBA with -pix_fmt ${format}`, async () => {
    const pixels = Buffer.from(Array.from({ length: 32 }, (_, i) =>
      (Math.floor(i / 4) % 4 * 23 + Math.floor(i / 16) * 47 + i % 4 * 59) % 256));
    const volume = Volume.fromJSON({ "/in.raw": pixels });
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "4x2",
        "-i", "/in.raw", "-frames:v", "1", "-c:v", "qoi", "-pix_fmt", format, "-f", "image2pipe", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = Buffer.concat(chunks);
    assert.equal(bytes[12], format === "rgba" ? 4 : 3);
    assert.equal(bytes.toString("hex"), format === "rgba"
      ? "716f696600000004000000020400ff003b76b1ff17528dc8ff2e69a4dfff4580bbf6ff2f6aa5e0ff4681bcf7ff5d98d30eff74afea250000000000000001"
      : "716f696600000004000000020300fe003b76b788b788b7888a88b788b788b7880000000000000001");
    const expected = pixels.map((value, i) => format === "rgba" || i % 4 !== 3 ? value : 255);
    assert.deepEqual(Buffer.from(decodeImage(bytes).data), expected);
  });
}
