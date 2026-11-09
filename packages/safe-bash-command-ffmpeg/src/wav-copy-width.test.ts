import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav, serializeWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

function fixture(storage: number, valid: number): Buffer {
  const wav = Buffer.alloc(116);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(40, 16); wav.writeUInt16LE(65534, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000 * storage / 8, 28);
  wav.writeUInt16LE(storage / 8, 32); wav.writeUInt16LE(storage, 34);
  wav.writeUInt16LE(22, 36); wav.writeUInt16LE(valid, 38); wav.writeUInt32LE(4, 40);
  Buffer.from([1, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113]).copy(wav, 44);
  wav.write("data", 60); wav.writeUInt32LE(48, 64);
  for (let i = 68; i < wav.length; i++) wav[i] = (i * 37) & 255;
  return wav;
}

function chunk(wav: Buffer, id: string): Buffer {
  for (let pos = 12; pos + 8 <= wav.length;) {
    const size = wav.readUInt32LE(pos + 4);
    if (wav.toString("ascii", pos, pos + 4) === id) return wav.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + size % 2;
  }
  throw new Error(`Missing ${id} chunk`);
}

// Native FFmpeg uses the enclosing codec width while retaining the input block alignment.
for (const [storage, valid, width] of [[32, 20, 24], [24, 20, 24], [32, 16, 16], [32, 32, 32], [24, 0, 24]] as const) {
  for (const pipe of [false, true]) it(`copies ${storage}/${valid}-bit WAV with ${width}-bit headers from ${pipe ? "pipe" : "file"}`, async () => {
    const input = fixture(storage, valid);
    const original = Buffer.from(input);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", pipe ? "pipe:0" : "/in.wav", "-c:a", "copy", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () { if (pipe) yield input; })(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.wav") as Buffer;
    assert.deepEqual(chunk(output, "data"), chunk(original, "data"));
    assert.deepEqual(volume.readFileSync("/in.wav"), original);
    const fmt = chunk(output, "fmt ");
    assert.equal(fmt.readUInt16LE(0), width > 16 ? 65534 : 1, "format tag");
    assert.equal(fmt.readUInt16LE(12), storage / 8, "block alignment");
    assert.equal(fmt.readUInt16LE(14), width, "bits per sample");
    assert.equal(fmt.readUInt32LE(4), 8000, "sample rate");
    assert.equal(fmt.readUInt32LE(8), 8000 * storage / 8, "byte rate");
    assert.equal(fmt.length, width > 16 ? 40 : 16, "format size");
    if (width > 16) {
      assert.equal(fmt.readUInt16LE(18), width, "valid bits");
      assert.equal(fmt.readUInt32LE(20), 4, "channel mask");
    }
  });
}

it("normalizes a borrowed Buffer header without modifying the source document", () => {
  const input = fixture(32, 20);
  const original = Buffer.from(input);
  const doc = parseWav(input, { decodeAudio: false });
  const output = Buffer.from(serializeWav(doc, { audioCodec: "copy" }));
  assert.equal(chunk(output, "fmt ").readUInt16LE(14), 24);
  assert.equal(chunk(output, "fmt ").readUInt16LE(18), 24);
  assert.deepEqual(chunk(output, "data"), chunk(input, "data"));
  assert.deepEqual(input, original);
  assert.deepEqual(doc.tracks[0]!.codecDescriptions[0]!.rawWavFormatBytes, chunk(original, "fmt "));
});
