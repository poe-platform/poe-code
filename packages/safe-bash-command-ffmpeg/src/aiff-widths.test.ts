import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg decodes these widths using the next whole-byte signed PCM format.
for (const [bits, expected] of [
  [4, [16384, 4096, 8192, 12288]],
  [12, [16400, 8240, -16160, -24432]],
  [20, [16400, 12480, -24432, 10253]],
  [28, [16400, -16160, 14120, -32566]]
] as const) {
  it(`decodes ${bits}-bit AIFF to native PCM16 samples through sync and async commands`, async () => {
    const input = Buffer.from("464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e44000000100000000000000000" + "40102030c0e0a09037280d2480ca0250".slice(0, Math.ceil(bits / 8) * 8), "hex");
    input.writeUInt32BE(input.length - 8, 4);
    input.writeUInt16BE(bits, 26);
    input.writeUInt32BE(input.length - 46, 42);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.aiff", input);
    const args = ["-y", "-v", "error", "-i", "/in.aiff", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(name: string) { return volume.readFileSync(name); },
        async writeFile(name: string, bytes: Uint8Array) { volume.writeFileSync(name, bytes); },
        async stat(name: string) { return volume.statSync(name); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, expected.length * 2);
    assert.deepEqual(expected.map((_, index) => output.readInt16LE(index * 2)), expected);
    volume.unlinkSync("/out.raw");
    assert.equal(evalSyncFfmpeg(args, undefined,
      name => volume.existsSync(name) ? volume.readFileSync(name) as Buffer : undefined,
      (name, bytes) => { volume.writeFileSync(name, bytes); return true; }), "");
    assert.deepEqual(volume.readFileSync("/out.raw"), output);
  });
}
