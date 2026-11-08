import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg flush counts for 8 kHz PCM converted to 11025 Hz.
for (const [length, frames] of [[8001, 11027], [1003, 1383], [1001, 1380], [8000, 11025]] as const) {
  for (const channels of [1, 2]) {
    it(`flushes ${frames} PCM frames from ${length} input frames (${channels} channels)`, async () => {
      const input = Buffer.alloc(length * channels * 2);
      for (let i = 0; i < length * channels; i++) input.writeInt16LE(i % channels ? -1000 : 1000, i * 2);
      const volume = Volume.fromJSON({ "/in.pcm": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels),
          "-i", "/in.pcm", "-ar", "11025", "-f", "s16le", "/out.pcm"],
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
      const output = volume.readFileSync("/out.pcm") as Buffer;
      assert.equal(output.length, frames * channels * 2);
      for (let i = 0; i < frames * channels; i++) assert.equal(output.readInt16LE(i * 2), i % channels ? -1000 : 1000);
    });
  }
}
