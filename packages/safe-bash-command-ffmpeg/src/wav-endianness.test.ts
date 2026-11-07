import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav, serializeWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const samples = [-32768, -16385, -257, -1, 0, 1, 257, 16385, 32767];
const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, value => value / 32768)] });

for (const codec of ["pcm_s16be", "pcm_s24be", "pcm_s32be", "pcm_f32be", "pcm_f64be"]) {
  it(`WAV writer rejects ${codec}`, () => {
    assert.throws(() => serializeWav(parseWav(input), { audioCodec: codec }),
      { message: `Codec ${codec} not supported in WAVE format` });
  });
}

for (const sync of [false, true]) {
  for (const codec of ["pcm_s16be", "pcm_s16le"]) {
    for (const forced of [false, true]) {
      it(`${sync ? "sync" : "async"} ${forced ? "forced" : "inferred"} WAV ${codec}`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", input);
        const path = forced ? "/out.bin" : "/out.wav";
        const args = ["-y", "-v", "error", "-i", "/in.wav", "-c:a", codec, ...(forced ? ["-f", "wav"] : []), path];
        const valid = codec === "pcm_s16le";
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined,
            name => volume.existsSync(name) ? volume.readFileSync(name) as Buffer : undefined,
            (name, bytes) => { volume.writeFileSync(name, bytes); return true; });
          assert.equal(result, valid ? "" : undefined);
        } else {
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
          assert.equal(result.exitCode, valid ? 0 : 1, stderr);
          if (!valid) assert.ok(stderr.includes(`Codec ${codec} not supported in WAVE format`), stderr);
        }
        assert.equal(volume.existsSync(path), valid);
        if (valid) {
          const output = volume.readFileSync(path) as Buffer;
          assert.equal(output.readUInt16LE(20), 1);
          assert.equal(output.readUInt16LE(34), 16);
          assert.equal(output.toString("ascii", 36, 40), "data");
          assert.deepEqual(samples.map((_, i) => output.readInt16LE(44 + i * 2)), samples);
          assert.equal(parseWav(output).tracks[0]!.codecDescriptions[0]!.codecName, codec);
        }
      });
    }
  }
}
