import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 preserves gray samples through implicit swapuv negotiation.
for (const [filter, expectedHex] of [
  ["swapuv", "2f3a45505b66717c"],
  ["swapuv,swapuv", "2f3a45505b66717c"],
  ["null", "2f3a45505b66717c"],
  ["format=yuv444p,format=gray", "2f3a45505b66717b"],
  ["format=yuv444p,swapuv,format=gray", "2f3a45505b66717b"],
  ["swapuv,extractplanes=u", "8080808080808080"],
  ["swapuv,extractplanes=v", "8080808080808080"]
] as const) {
  it(`preserves native grayscale negotiation for ${filter}`, async () => {
    const input = Buffer.from("2f3a45505b66717c", "hex");
    const volume = Volume.fromJSON({ "/in.raw": Buffer.concat([input, input]) });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "4x2",
        "-i", "/in.raw", "-vf", filter, "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(errors).length, 0);
    assert.equal(Buffer.concat(output).toString("hex"), expectedHex.repeat(2));
    assert.deepEqual(volume.readFileSync("/in.raw"), Buffer.concat([input, input]));
  });
}
