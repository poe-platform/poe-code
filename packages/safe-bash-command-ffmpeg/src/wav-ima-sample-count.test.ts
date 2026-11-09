import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const channels of [1, 2]) {
  const blockFrames = channels === 1 ? 2041 : 1017;
  for (const count of [0, 9, blockFrames, 4096]) {
    it(`writes unpadded IMA WAV fact count for ${count} frames in ${channels} channels`, async () => {
      const input = Buffer.alloc(count * channels * 2);
      for (let i = 0; i < count * channels; i++) input.writeInt16LE((i * 331) % 60001 - 30000, i * 2);
      const volume = Volume.fromJSON({ "/in.pcm": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels),
          "-i", "/in.pcm", "-c:a", "adpcm_ima_wav", "/out.wav"],
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
      const output = volume.readFileSync("/out.wav") as Buffer;
      const chunks = new Map<string, Buffer>();
      for (let offset = 12; offset + 8 <= output.length;) {
        const size = output.readUInt32LE(offset + 4);
        chunks.set(output.toString("ascii", offset, offset + 4), output.subarray(offset + 8, offset + 8 + size));
        offset += 8 + size + (size % 2);
      }
      assert.equal(chunks.get("data")!.length, Math.ceil(count / blockFrames) * 1024);
      assert.equal(chunks.get("fmt ")!.readUInt16LE(18), blockFrames);
      assert.equal(chunks.get("fact")!.readUInt32LE(), Math.max(1, count));
    });
  }
}
