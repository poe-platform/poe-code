import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`transcodes RF64 ds64 input without changing any PCM samples (${sync ? "sync" : "async"})`, async () => {
    const input = Buffer.alloc(80 + 4096);
    input.write("RF64"); input.writeUInt32LE(0xffffffff, 4); input.write("WAVEds64", 8);
    input.writeUInt32LE(28, 16); input.writeBigUInt64LE(BigInt(input.length - 8), 20);
    input.writeBigUInt64LE(4096n, 28); input.writeBigUInt64LE(1024n, 36);
    input.write("fmt ", 48); input.writeUInt32LE(16, 52);
    input.writeUInt16LE(1, 56); input.writeUInt16LE(2, 58);
    input.writeUInt32LE(8000, 60); input.writeUInt32LE(32000, 64);
    input.writeUInt16LE(4, 68); input.writeUInt16LE(16, 70);
    input.write("data", 72); input.writeUInt32LE(0xffffffff, 76);
    const samples = [-32768, 32767, -12345, 23456, -1, 0, 1, 256];
    for (let i = 0; i < 2048; i++) input.writeInt16LE(samples[i % samples.length]!, 80 + i * 2);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    const args = ["-v", "error", "-y", "-i", "/in.wav", "-c:a", "pcm_s16le", "/out.wav"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
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
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData.length, 2);
    for (const channel of audio.channelData) assert.equal(channel.length, 1024);
    let pcm: Buffer | undefined;
    for (let offset = 12; offset + 8 <= output.length;) {
      const size = output.readUInt32LE(offset + 4);
      if (output.toString("ascii", offset, offset + 4) === "data") pcm = output.subarray(offset + 8, offset + 8 + size);
      offset += 8 + size + size % 2;
    }
    assert.deepEqual(pcm, input.subarray(80));
  });
}
