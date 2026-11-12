import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const rgba = Buffer.from("ff0000ff00ff00800000ff4000000000", "hex");
// Native FFmpeg 7.0.2, RGBA8 2x2 input, default swscale conversion.
const expected = {
  grayf32le: "a3f8a23e918c103fa4e0233e8000803d",
  gbrpf32le: "e000e038ff087f3f0000000000000000000000008000003aff017f3f00000000ff037f3f00000000f800f83900000000",
  gbrapf32le: "e000e038ff087f3f0000000000000000000000008000003aff017f3f00000000ff037f3f00000000f800f8390000000000fd7f3f8080003f8080803e00000000"
};

const varied = Buffer.from("ffffffff010203017f80817fef7b0581", "hex");
const variedExpected: Record<string, string> = {
  grayf32le: "eb006b3f8c808c3dfc88fb3e8cdc0b3f",
  gbrpf32le: "ff037f3f8080003c8002003ff60ef63eff037f3fc100413c81fb003f9e209e3cff037f3fff007f3bfefcfd3eeff16e3f",
  gbrapf32le: "ff037f3f8080003c8002003ff60ef63eff037f3fc100413c81fb003f9e209e3cff037f3fff007f3bfefcfd3eeff16e3f00fd7f3f8000803bfff8fe3e8280013f"
};

async function run(format: string, input = rgba, options: Parameters<typeof createFfmpegCommand>[0] = {}, output = "pipe:1", filter?: string) {
  const volume = Volume.fromJSON({ "/in.rgba": input, "/out.raw": "KEEP" });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2",
      "-i", "/in.rgba", ...(filter ? ["-vf", filter] : []), "-pix_fmt", format, "-f", "rawvideo", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.rgba"), input);
  return { ...result, stderr, output: output === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(output) };
}

for (const [format, hex] of Object.entries(expected)) {
  it(`writes native ${format} float samples to stdout`, async () => {
    const result = await run(format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.output, Buffer.from(hex, "hex"));
  });

  it(`writes ${format} planes per frame through null within the exact output limit`, async () => {
    const bytes = Buffer.from(hex, "hex");
    const result = await run(format, Buffer.concat([rgba, varied]),
      { limits: { maxOutputBytes: bytes.length * 2 } }, "/out.raw", "null");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.concat([bytes, Buffer.from(variedExpected[format]!, "hex")]));
  });

  for (const output of ["pipe:1", "/out.raw"]) {
    it(`bounds all ${format} float planes before writing ${output}`, async () => {
      const result = await run(format, Buffer.concat([rgba, rgba]),
        { limits: { maxOutputBytes: hex.length - 1 } }, output);
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /maxOutputBytes/);
      assert.equal(result.output.toString(), output === "pipe:1" ? "" : "KEEP");
    });
  }
}

it("preserves the packed RGBA control bytes", async () => {
  const result = await run("rgba");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, rgba);
});
