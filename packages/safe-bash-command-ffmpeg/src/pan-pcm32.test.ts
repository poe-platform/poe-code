import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 outputs; the input samples are exactly representable as float32.
const input = "00001027000048f40000589e000068420000307500001879000000830000cf8a00000004000038150000c7cf0000a05b";
for (const [filter, expected] of [
  ["pan=mono|c0=2*c0,volume=0.5:precision=double", "00001027000000c000000040000000c0000000040000c7cf"],
  ["anull,pan=mono|c0=2*c0,volume=0.5:precision=double", "00001027000000c000000040000000c0000000040000c7cf"],
  ["volume=1:precision=fixed,pan=mono|c0=2*c0,volume=0.5:precision=double", "00001027000000c000000040000000c0000000040000c7cf"],
  ["aformat=sample_fmts=flt,aformat=sample_fmts=s32,pan=mono|c0=2*c0,volume=0.5:precision=double", "00001027000000c000000040000000c0000000040000c7cf"],
  ["aeval=val(0)|val(1),pan=mono|c0=2*c0,volume=0.5:precision=double", "000010270000589e0000307500000083000000040000c7cf"],
  ["pan=mono|c0=2*c0", "0000204e00000080ffffff7f000000800000000800008e9f"],
  ["pan=mono|c0=c0", "000010270000589e0000307500000083000000040000c7cf"],
  ["aformat=sample_fmts=flt,pan=mono|c0=2*c0,volume=0.5:precision=double", "000010270000589e0000307500000083000000040000c7cf"],
  ["volume=1:precision=double,pan=mono|c0=2*c0,volume=0.5:precision=double", "000010270000589e0000307500000083000000040000c7cf"]
] as const) {
  for (const complex of [false, true]) {
    it(`matches native PCM32 pan saturation (${complex ? "graph" : "simple"}): ${filter}`, async () => {
      const fs = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex"), "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s32le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s32le", "/out.raw"],
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
