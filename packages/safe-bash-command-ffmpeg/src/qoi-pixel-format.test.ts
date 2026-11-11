import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Two colored RGBA pixels, the first partially transparent.
const input = Buffer.from("716f696600000002000000010400ff80402080ff1248aaff0000000000000001", "hex");

for (const format of ["gray", "gray8"]) {
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
