import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 outputs for six interleaved stereo frames.
for (const [format, input, mono, swapped] of [
  ["s32le", "01001027020048f40300589e040068420500307506001879070000830800cf8a090000040a0038150b00c7cf0c00a05b", "010010270300589e0500307507000083090000040b00c7cf", "020048f401001027040068420300589e06001879050030750800cf8a070000830a003815090000040c00a05b0b00c7cf"],
  ["f64le", "70be0d000088e33f810c92ffff6fc7bf5862ebffff69f8bfe07c1b00009af03f185c2200004cfd3f503b29000046fe3f78e5cfffff3fffbf4006c9ff3f4cfdbf7b8fdd030000b03fbfe012010038d53f31d168ff7f1ce8bfa076520000e8f63f", "70be0d000088e33f5862ebffff69f8bf185c2200004cfd3f78e5cfffff3fffbf7b8fdd030000b03f31d168ff7f1ce8bf", "810c92ffff6fc7bf70be0d000088e33fe07c1b00009af03f5862ebffff69f8bf503b29000046fe3f185c2200004cfd3f4006c9ff3f4cfdbf78e5cfffff3fffbfbfe012010038d53f7b8fdd030000b03fa076520000e8f63f31d168ff7f1ce8bf"]
] as const) {
  for (const [filter, expected] of [
    ["pan=mono|c0=c0", mono],
    ["pan=stereo|c0=c1|c1=c0", swapped],
    ["anull", input]
  ]) {
    for (const complex of [false, true]) {
      it(`preserves original ${format} samples: ${filter} (${complex ? "graph" : "simple"})`, async () => {
        const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
        fs.writeFileSync("/in.raw", Buffer.from(input, "hex"));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", format, "-ar", "8000", "-ac", "2", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
