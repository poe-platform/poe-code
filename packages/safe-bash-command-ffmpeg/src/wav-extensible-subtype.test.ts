import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [tag, bits, payload, expected] of [
  [7, 8, "000f677effffe78f80", [-32124, -16764, -260, -8, 0, 0, 260, 16764, 32124]],
  [6, 8, "2a3a4555d5d5c5baaa", [-32256, -16128, -264, -8, 8, 8, 264, 16128, 32256]],
  [1, 8, "0001407f8081c0feff", [-32768, -32512, -16384, -256, 0, 256, 16384, 32256, 32512]],
  [3, 32, "0000003f000000bf0000803e000080be", [16384, -16384, 8192, -8192]],
] as const) {
for (const sync of [false, true]) {
  it(`decodes extensible WAV subtype ${tag} to PCM16 (${sync ? "sync" : "async"})`, async () => {
    const data = Buffer.from(payload, "hex");
    const header = Buffer.from("524946460000000057415645666d742028000000feff0100401f0000000000000000000016000000040000000000000000001000800000aa00389b716461746100000000", "hex");
    header.writeUInt32LE(header.length + data.length + data.length % 2 - 8, 4);
    header.writeUInt32LE(8000 * bits / 8, 28);
    header.writeUInt16LE(bits / 8, 32);
    header.writeUInt16LE(bits, 34);
    header.writeUInt16LE(bits, 38);
    header.writeUInt32LE(tag, 44);
    header.writeUInt32LE(data.length, 64);
    const input = Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
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
    assert.deepEqual(Array.from({ length: expected.length }, (_, i) => output.readInt16LE(dataOffset + i * 2)), expected);
  });
}
}
