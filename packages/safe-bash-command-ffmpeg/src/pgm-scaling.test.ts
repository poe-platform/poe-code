import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: exit 0 and exact rawvideo stdout.
for (const [name, inputHex, format, expected] of [
  ["P5 maxval 254", "50350a3420310a3235340a00017ffe", "gray", "00018000"],
  ["P5 maxval 65534", "50350a3420310a36353533340a000000017ffffffe", "gray16be", "0000000180000000"],
  ["P5 maxval 255", "50350a3420310a3235350a00017fff", "gray", "00017fff"],
  ["P5 maxval 65535", "50350a3420310a36353533350a000000017fffffff", "gray16be", "000000017fffffff"],
  ["P2 maxval 254", "50320a3420310a3235340a30203120313237203235340a", "gray", "000180ff"]
] as const) {
  for (const source of ["file", "pipe", "sequence", "detected"]) {
    it(`matches native ${name} scaling from ${source}`, async () => {
      const input = Buffer.from(inputHex, "hex");
      const volume = Volume.fromJSON({ "/in.pgm": input, "/in1.pgm": input, "/in2.pgm": input, "/in.bin": input });
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", ...(source === "pipe" ? ["-f", "image2pipe", "-c:v", "pgm"] : []),
          "-i", source === "pipe" ? "pipe:0" : source === "sequence" ? "/in%d.pgm" : source === "detected" ? "/in.bin" : "/in.pgm",
          "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { yield input; yield input; })(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(Buffer.concat(output).toString("hex"), expected.repeat(source === "pipe" || source === "sequence" ? 2 : 1));
    });
  }
}
