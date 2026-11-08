import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 9.0.1: encode PCM16 ((i * 331) % 60001) - 30000 at
// 8000 Hz, then retain complete groups with partial tails. The full-block
// fixture uses zero deltas to verify every recovered sample.
// Current FFmpeg rounds each step contribution separately; 7.0.2 did not.
for (const [payload, expected] of [
  ["d08a000077777706", "d08adb8af98a388bc08be58c5c8ff4939494"],
  ["d08a0000", "d08a"],
  ["d08a000077", "d08a"],
  ["d08a000077777706ff", "d08adb8af98a388bc08be58c5c8ff4939494"],
  ["d08a0000" + "00".repeat(1021), "d08a".repeat(2041)],
  ["d0", ""]
] as const) {
  it(`matches native IMA WAV predictor rounding for ${payload.length / 2} data bytes`, async () => {
    const input = Buffer.concat([
      Buffer.from("524946460000000057415645666d74201400000011000100401f0000ad0f0000000404000200f9076461746100000000", "hex"),
      Buffer.from(payload, "hex")
    ]);
    input.writeUInt32LE(input.length - 8, 4);
    input.writeUInt32LE(input.length - 48, 44);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    const args = ["-v", "error", "-i", "/in.wav", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, expected ? 0 : 69, stderr);
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    if (!expected) return; // The sync evaluator delegates decode-error reporting to async execution.
    volume.unlinkSync("/out.raw");
    assert.equal(evalSyncFfmpeg(args, undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
  });
}
