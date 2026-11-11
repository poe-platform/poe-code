import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg output bytes from interleaved stereo frames at 8000 Hz.
const floatInput = "00401c3f00803bbe0050c3bf00d0843f0060ea3f0030f23f0000fabf0062eabf0000803d00c0a93e00e440bf0040b73f";
const pcmInput = "00001027000048f40000589e000068420000307500001879000000830000cf8a00000004000038150000c7cf0000a05b";
for (const [format, input, filter, expected] of [
  ["f32le", floatInput, "pan=mono|c0=0.2*c0+0.7*c1", "0000c8bb00a0d73e0068d83f6611d6bf33737a3eccf8593f"],
  ["f32le", floatInput, "pan=mono|c0=0.1*c0+0.9*c1", "0080d4bd0000483f0068f13fccf1ebbf99f99b3ecd479b3f"],
  ["s32le", pcmInput, "pan=mono|c0=0.2*c0+0.7*c1", "00009cff0000f41a0000346c004df7943033a70f00337e36"],
  ["s32le", pcmInput, "pan=mono|c0=0.5*c0+0.5*c1", "0000ac0d000060f0000024770080e78600009c0c0080b315"],
  ["s32le", "7156341200000000", "pan=mono|c0=0.375*c0", "70a0d306"],
  ["s32le", "8056341200000000", "pan=mono|c0=0.375*c0", "70a0d306"],
  ["s32le", "7156341200000000", "pan=mono|c0=c0", "71563412"],
  ["f32le", floatInput, "anull", floatInput]
] as const) {
  for (const complex of [false, true] as const) {
    it(`matches native pan gain precision (${format}, ${complex ? "graph" : "simple"}): ${filter}`, async () => {
      const fs = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex"), "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", format, "-ar", "8000", "-ac", "2", "-i", "/in.raw",
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
      assert.equal(stderr, "");
      assert.equal((fs.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    });
  }
}
