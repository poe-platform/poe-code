import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Encoded bytes and PCM16 reference samples from native FFmpeg.
for (const [tag, payload, expected] of [
  [7, "000f677effffe78f80", [-32124, -16764, -260, -8, 0, 0, 260, 16764, 32124]],
  [6, "2a3a4555d5d5c5baaa", [-32256, -16128, -264, -8, 8, 8, 264, 16128, 32256]],
  [1, "0001407f8081c0feff", [-32768, -32512, -16384, -256, 0, 256, 16384, 32256, 32512]]
] as const) {
for (const sync of [false, true]) {
  it(`decodes WAV tag ${tag} to PCM16 (${sync ? "sync" : "async"})`, async () => {
    // Nine 8-bit samples, an 18-byte WAVEFORMATEX, and an odd-sized data chunk.
    const input = Buffer.from("524946463400000057415645666d74201200000007000100401f0000401f00000100080000006661637404000000090000006461746109000000000f677fffffe78f8000", "hex");
    input.writeUInt32LE(input.length - 8, 4);
    input.writeUInt16LE(tag, 20);
    Buffer.from(payload, "hex").copy(input, 58);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    const args = ["-v", "error", "-y", "-i", "/in.wav", "-c:a", "pcm_s16le", "/out.wav"];
    if (sync) {
      const result = evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
      assert.equal(result, "");
    } else {
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
      assert.equal(result.exitCode, 0, stderr);
    }
    const output = volume.readFileSync("/out.wav") as Buffer;
    const dataOffset = output.indexOf("data") + 8;
    assert.deepEqual(Array.from({ length: 9 }, (_, i) => output.readInt16LE(dataOffset + i * 2)), expected);
  });
}
}
