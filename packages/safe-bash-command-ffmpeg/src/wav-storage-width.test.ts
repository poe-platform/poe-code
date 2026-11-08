import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [storage, expected] of [
  [8, [-32768, -16384, 0, 16384]],
  [16, [16384, -16256, -8160, -12240]],
  [24, [-32704, -8160, 4304, -20400]],
  [32, [-16256, -12240, -20400]]
] as const) for (const bits of [storage - 4, storage]) {
  it(`transcodes legacy PCM ${bits} using ${storage}-bit storage`, async () => {
    const data = Buffer.from("004080c020e030d010f050b0", "hex").subarray(0, storage / 2);
    const input = Buffer.alloc(44 + data.length);
    input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
    input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(1, 22);
    input.writeUInt32LE(8000, 24); input.writeUInt32LE(8000 * storage / 8, 28);
    input.writeUInt16LE(storage / 8, 32); input.writeUInt16LE(bits, 34);
    input.write("data", 36); input.writeUInt32LE(data.length, 40); data.copy(input, 44);
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
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.raw") as Buffer;
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}
