import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM32 output for double input [0, .123456789, -.34567891, .77777777].
for (const [filter, expected] of [
  ["anull", "000000009c6ecd0f21cbc0d3d3388e63"],
  ["crystalizer=i=0", "000000009c6ecd0f21cbc0d3d3388e63"],
  ["crystalizer", "00000000d34b682f00000080ffffff7f"],
  ["crystalizer=i=-0.3", "00000000ecde270c6ae3c4e098c25f45"],
  ["crystalizer=enable=0", "000000009c6ecd0f21cbc0d3d3388e63"],
  ["aformat=sample_fmts=dblp,crystalizer", "00000000d34b682f00000080ffffff7f"],
  ["asendcmd=c='0 crystalizer i -0.3',crystalizer=i=0", "00000000ecde270c6ae3c4e098c25f45"],
  ["aformat=sample_fmts=flt,crystalizer", "00000000004c682f00000080ffffff7f"],
  ["aformat=sample_fmts=fltp,crystalizer=i=-0.3", "00000000f0de270c80e3c4e000c35f45"],
  ["crystalizer=c=0,volume=0.25:precision=double", "00000000f512da0b0be1e9d60d45ca60"]
] as const) {
  for (const complex of [false, true]) {
    it(`preserves double input precision through ${filter} (${complex ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(32);
      [0, .123456789, -.34567891, .77777777].forEach((sample, index) => input.writeDoubleLE(sample, index * 8));
      const volume = Volume.fromJSON({ "/in.pcm": input });
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "f64le", "-ar", "1000", "-ac", "1", "-i", "/in.pcm",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s32le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(output).toString("hex"), expected);
    });
  }
}
