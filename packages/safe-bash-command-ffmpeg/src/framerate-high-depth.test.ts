import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete outputs captured from FFmpeg 7.0.2 with the same input and arguments.
for (const [format, input, filter, expected] of [
  ["yuv420p10le", "2d002d002d002d0082009301950095009500950006029300", "framerate=8:flags=0",
    "2d002d002d002d0082009301610061006100610044011301950095009500950006029300950095009500950006029300"],
  ["gray16le", "140b140b140b140b2e252e252e252e25", "framerate=8:flags=0",
    "110b110b110b110b2a182a182a182a1831253125312531253125312531253125"],
  ["yuv420p10le", "2d002d002d002d0082009301950095009500950006029300", "framerate=7:flags=0",
    "2d002d002d002d0082009301680068006800680060010101950095009500950006029300950095009500950006029300"],
  ["yuv444p10le", "2d002d002d002d0082008200820082009301930193019301950095009500950006020602060206029300930093009300", "framerate=7:flags=0",
    "2d002d002d002d0082008200820082009301930193019301680068006800680060016001600160010101010101010101950095009500950006020602060206029300930093009300950095009500950006020602060206029300930093009300"],
  ["yuv420p10le", "2d002d002d002d0082009301950095009500950006029300", "framerate=8",
    "2d002d002d002d00820093012d002d002d002d0082009301950095009500950006029300950095009500950006029300"],
  ["gray16le", "140b140b140b140b2e252e252e252e25", "framerate=8",
    "110b110b110b110b110b110b110b110b31253125312531253125312531253125"],
  ["gray16be", "0b140b140b140b14252e252e252e252e", "framerate=7:flags=0",
    "0b110b110b110b1119fc19fc19fc19fc25312531253125312531253125312531"],
  ["yuv420p10le", "2d002d002d002d0082009301950095009500950006029300", "fps=8",
    "2d002d002d002d00820093012d002d002d002d0082009301950095009500950006029300950095009500950006029300"],
  ["gray16le", "140b140b140b140b2e252e252e252e25", "null",
    "140b140b140b140b2e252e252e252e25"]
] as const) {
  for (const graph of [false, true]) it(`matches native ${format} ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const bytes = Buffer.from(input, "hex");
    const volume = Volume.fromJSON({ "/in.raw": bytes });
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pix_fmt", format, "-s", "2x2", "-r", "4", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
        "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(data: Uint8Array) { stdout.push(data); } },
      stderr: { async write(data: Uint8Array) { stderr.push(data); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
    assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    assert.deepEqual(volume.readFileSync("/in.raw"), bytes);
  });
}
