import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) for (const bigEndian of [false, true]) {
  it(`decodes ${bigEndian ? "RIFX" : "RIFF"} PCM8 WAV (${sync ? "sync" : "async"})`, async () => {
    const samples = [-32768, -16384, 0, 16384, 32512, 0];
    const payload = Buffer.from([0, 64, 128, 192, 255, 128]);
    const input = Buffer.alloc(44 + payload.length);
    const write32 = (value: number, offset: number) => bigEndian ? input.writeUInt32BE(value, offset) : input.writeUInt32LE(value, offset);
    const write16 = (value: number, offset: number) => bigEndian ? input.writeUInt16BE(value, offset) : input.writeUInt16LE(value, offset);
    input.write(bigEndian ? "RIFX" : "RIFF"); write32(input.length - 8, 4); input.write("WAVEfmt ", 8);
    write32(16, 16); write16(1, 20); write16(1, 22);
    write32(8000, 24); write32(8000, 28);
    write16(1, 32); write16(8, 34);
    input.write("data", 36); write32(payload.length, 40); payload.copy(input, 44);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const args = ["-y", "-v", "error", "-i", "/in.wav", "-c:a", "pcm_s16le", "/out.wav"];
    if (sync) {
      const result = evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
      assert.equal(result, "");
    } else {
      const result = await createFfmpegCommand().execute({
        args,
        cwd: "/", env: {}, signal: new AbortController().signal,
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
    let actual: Buffer | undefined;
    let format: Buffer | undefined;
    for (let offset = 12; offset + 8 <= output.length;) {
      const size = output.readUInt32LE(offset + 4);
      const chunk = output.subarray(offset + 8, offset + 8 + size);
      const tag = output.toString("ascii", offset, offset + 4);
      if (tag === "fmt ") format = chunk;
      if (tag === "data") actual = chunk;
      offset += 8 + size + (size % 2);
    }
    assert.ok(format);
    assert.equal(format.readUInt16LE(0), 1);
    assert.equal(format.readUInt16LE(2), 1);
    assert.equal(format.readUInt32LE(4), 8000);
    assert.equal(format.readUInt16LE(14), 16);
    assert.ok(actual);
    assert.deepEqual(Array.from({ length: actual.length / 2 }, (_, i) => actual!.readInt16LE(i * 2)), samples);

  });
}
