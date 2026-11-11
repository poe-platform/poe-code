import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: four interleaved stereo PCM16 frames at 8000 Hz.
for (const [filter, samples] of [
  ["pan=FL|FL=FR,aformat=channel_layouts=stereo", [-142, -142, -708, -708, 23169, 23169, 6364, 6364]],
  ["pan=FR|FR=FL,aformat=channel_layouts=stereo", [708, 708, 2122, 2122, -23170, -23170, 1414, 1414]],
  ["pan=FL|FL=FR,aformat=cl=stereo", [-142, -142, -708, -708, 23169, 23169, 6364, 6364]],
  ["pan=FR|FR=FL,aformat=cl=stereo", [708, 708, 2122, 2122, -23170, -23170, 1414, 1414]],
  ["pan=FL|FL=FR", [-201, -1001, 32767, 9000]],
  ["pan=FR|FR=FL", [1001, 3001, -32768, 2000]],
  ["pan=FL|FL=FR,aformat=channel_layouts=mono", [-201, -1001, 32767, 9000]],
  ["pan=FR|FR=FL,aformat=channel_layouts=mono", [1001, 3001, -32768, 2000]],
  ["pan=FC|FC=FR,aformat=channel_layouts=stereo", [-142, -142, -708, -708, 23169, 23169, 6364, 6364]]
] as const) {
  for (const graph of [false, true]) {
    it(`matches single-speaker PCM16 samples for ${filter} (graph=${graph})`, async () => {
      const volume = new Volume();
      const input = Buffer.alloc(16);
      [1001, -201, 3001, -1001, -32768, 32767, 2000, 9000]
        .forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      const chunks: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "pipe:0",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { yield input; })(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const expected = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => expected.writeInt16LE(sample, index * 2));
      assert.deepEqual(Buffer.concat(chunks), expected);
    });
  }
}
