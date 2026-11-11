import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 outputs, including positive/negative half steps and clipping.
for (const [filter, u8, s16le, f32le] of [
  ["pan=mono|c0=0.5*c0", "80bf7f4081be", "0000003f00ff00c00001003e", "000000000000fc3e000000bc000000bf0000003c0000f83e"],
  ["aformat=sample_fmts=u8p,pan=mono|c0=0.5*c0", "80bf7f4081be", "0000003f00ff00c00001003e", "000000000000fc3e000000bc000000bf0000003c0000f83e"],
  ["pan=mono|c0=-0.5*c0", "7f4080c07e41", "00ff00c00000004000fe00c1", "000000bc000000bf000000000000003f000080bc0000fcbe"],
  ["pan=stereo|c0=2*c0|c1=c1", "8280ff807e8000808680ff80", "00020000007f000000fe00000080000000060000007f0000", "0000803c0000000000007e3f00000000000080bc00000000000080bf000000000000403d0000000000007e3f00000000"],
  ["pan=mono|c0=0.99999*c0", "81ff7f0083fd", "0001007f00ff00800003007d", "0000003c00007e3f000000bc000080bf0000c03c00007a3f"],
  ["pan=mono|c0=0.5*c0,pan=mono|c0=0.5*c0", "809f7f60809f", "0000001f00ff00e00000001f", "000000000000783e000000bc000080be000000000000783e"],
  ["pan=mono|c0=c0", "81ff7f0083fd", "0001007f00ff00800003007d", "0000003c00007e3f000000bc000080bf0000c03c00007a3f"]
] as const) {
  for (const [format, expected] of [["u8", u8], ["s16le", s16le], ["f32le", f32le]]) {
    for (const complex of [false, true]) {
      it(`quantizes unsigned 8-bit pan before ${format} export (${complex ? "graph" : "simple"}): ${filter}`, async () => {
        const fs = Volume.fromJSON({ "/out.raw": "keep" });
        fs.writeFileSync("/in.raw", Buffer.from("8180ff807f8000808380fd80", "hex"));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "u8", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", format, "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal((fs.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      });
    }
  }
}
