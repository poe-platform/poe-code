import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const values = [17n, -17n, 2n ** 53n + 1n, -(2n ** 53n + 1n),
  2n ** 60n + 123n, -(2n ** 60n + 123n), 2n ** 63n - 1n, -(2n ** 63n)];

for (const channels of [1, 2]) {
  for (const filter of ["anull", "areverse", "areverse,areverse", "anull,areverse,acopy", "copy"]) {
    it(`preserves signed PCM64 WAV samples through ${filter} (${channels} channels)`, async () => {
      const frames = 2051; // Cross WAV packet boundaries, including a partial final packet.
      const input = Buffer.alloc(44 + frames * channels * 8);
      input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
      input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(channels, 22);
      input.writeUInt32LE(8000, 24); input.writeUInt32LE(8000 * channels * 8, 28);
      input.writeUInt16LE(channels * 8, 32); input.writeUInt16LE(64, 34);
      input.write("data", 36); input.writeUInt32LE(input.length - 44, 40);
      for (let i = 0; i < frames * channels; i++) input.writeBigInt64LE(values[i % values.length]!, 44 + i * 8);
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "wav", "-i", "/in.raw",
          ...(filter === "copy" ? ["-c:a", "copy"] : ["-af", filter, "-c:a", "pcm_s64le"]), "-f", "wav", "/out.raw"],
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
      const track = parseWav(volume.readFileSync("/out.raw") as Buffer, { decodeAudio: false }).tracks[0]!;
      const actual = Buffer.concat(track.samples.map(sample => sample.data));
      assert.equal(actual.length, input.length - 44);
      const reverse = filter.split(",").filter(name => name === "areverse").length % 2 === 1;
      for (let frame = 0; frame < frames; frame++) {
        for (let channel = 0; channel < channels; channel++) {
          const source = ((reverse ? frames - frame - 1 : frame) * channels + channel) * 8;
          assert.equal(actual.readBigInt64LE((frame * channels + channel) * 8), input.readBigInt64LE(44 + source));
        }
      }
    });
  }
}
