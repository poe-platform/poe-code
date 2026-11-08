import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav, serializeWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [blockSize, format, ppv] of [[256, 2, 2], [64, 2, 2], [256, 1, 2], [256, 2, 1], [255, 1, 1], [0, 2, 2]] as const) {
    for (const mode of ["on", "only", "off", "0", "1", "2"]) {
      it(`writes WAV peak envelope ${mode} ${blockSize}/${format}/${ppv} (${sync ? "sync" : "async"})`, async () => {
        const input = Buffer.alloc(44 + 4096);
        input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
        input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(2, 22);
        input.writeUInt32LE(8000, 24); input.writeUInt32LE(32000, 28);
        input.writeUInt16LE(4, 32); input.writeUInt16LE(16, 34);
        input.write("data", 36); input.writeUInt32LE(4096, 40);
        const samples = [-32768, 32767, -12345, 23456, -1, 0, 1, 256];
        for (let i = 0; i < 2048; i++) input.writeInt16LE(samples[i % samples.length]!, 44 + i * 2);
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", input);
        const args = ["-v", "error", "-y", "-i", "/in.wav", "-peak_block_size", String(blockSize), "-peak_format", String(format), "-peak_ppv", String(ppv), "-write_peak", mode, "/out.wav"];
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
        assert.equal(output.readUInt32LE(4), output.length - 8);
        const chunks = new Map<string, Buffer>();
        for (let offset = 12; offset < output.length;) {
          const size = output.readUInt32LE(offset + 4);
          chunks.set(output.toString("ascii", offset, offset + 4), output.subarray(offset + 8, offset + 8 + size));
          offset += 8 + size + size % 2;
        }
        if (mode === "only" || mode === "2") {
          assert.deepEqual([...chunks.keys()].filter(key => key !== "LIST"), blockSize === 0 ? [] : ["levl"]);
        } else {
          assert.deepEqual(chunks.get("data"), input.subarray(44));
          assert.deepEqual(parseWav(output).tracks[0]!.decodedAudio, parseWav(input).tracks[0]!.decodedAudio);
        }
        if (mode === "off" || mode === "0" || blockSize === 0) {
          assert.equal(chunks.has("levl"), false);
        } else {
          const peak = chunks.get("levl")!;
          assert.ok(peak);
          const blocks = Math.ceil(1024 / blockSize);
          assert.equal(peak.length, 120 + blocks * 2 * format * ppv);
          assert.deepEqual(Array.from({ length: 8 }, (_, i) => peak.readUInt32LE(i * 4)),
            [1, format, ppv, blockSize, 2, blocks, 0xffffffff, 128]);
          // Native FFmpeg stores signed 16-bit extrema; -32768 wraps when
          // negated for ppv=1, so the positive peak wins in that case.
          const record = format === 2
            ? ppv === 2 ? "01000080ff7f0000" : "0100ff7f"
            : ppv === 2 ? "00807f00" : "007f";
          assert.deepEqual(peak.subarray(120), Buffer.from(record.repeat(blocks), "hex"));
        }
      });
    }
  }
}

it("writes an incomplete final peak block and supports PCM stream copy", () => {
  const input = Buffer.alloc(44 + 257 * 2);
  input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
  input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(1, 22);
  input.writeUInt32LE(8000, 24); input.writeUInt32LE(16000, 28);
  input.writeUInt16LE(2, 32); input.writeUInt16LE(16, 34);
  input.write("data", 36); input.writeUInt32LE(514, 40);
  input.writeInt16LE(100, 44); input.writeInt16LE(-200, 46); input.writeInt16LE(-300, 556);
  for (const audioCodec of [undefined, "copy"]) {
    const output = Buffer.from(serializeWav(parseWav(input), { writePeak: "only", audioCodec }));
    assert.equal(output.readUInt32LE(4), output.length - 8);
    assert.equal(output.readUInt32LE(40), 2);
    assert.deepEqual(output.subarray(140), Buffer.from([100, 0, 200, 0, 0, 0, 44, 1]));
  }
  const compact = Buffer.from(serializeWav(parseWav(input), {
    writePeak: "only", peakBlockSize: 64, peakFormat: 1, peakPpv: 1
  }));
  assert.equal(compact.readUInt32LE(4), compact.length - 8);
  assert.equal(compact.readUInt32LE(16), 125);
  assert.deepEqual(compact.subarray(140), Buffer.from([0, 0, 0, 0, 1, 0]));
  for (const options of [
    { peakBlockSize: -1 }, { peakBlockSize: 65537 }, { peakBlockSize: 1.5 },
    { peakFormat: 0 }, { peakFormat: 3 }, { peakPpv: 0 }, { peakPpv: 3 }
  ]) assert.throws(() => serializeWav(parseWav(input), { writePeak: "on", ...options }), /Invalid peak_/);
  assert.throws(() => serializeWav(parseWav(input), { writePeak: "on", audioCodec: "pcm_f32le" }),
    { message: "Peak envelope requires 16-bit PCM audio" });
});
