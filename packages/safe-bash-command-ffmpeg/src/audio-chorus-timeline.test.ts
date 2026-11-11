import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: timeline options fail even when enable is zero.
for (const [suffix, status] of [[":enable=0", 176], [":enable=1", 176], [":bogus=1", 8], ["", 0]] as const) {
  for (const graph of [false, true]) {
    it(`chorus ${suffix || "control"} preserves native status and PCM (graph ${graph})`, async () => {
      const volume = new Volume();
      const channels = [1, -1].map(sign => Float64Array.from([100, 200, 300, 400], sample => sign * sample / 32768));
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
      const filter = `chorus=0.6:0.7:1:0.4:2:0.25${suffix}`;
      let stderr = "";
      const output: Buffer[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, status, stderr);
      const expected = Buffer.alloc(status === 0 ? 56 : 0);
      if (status === 0) {
        [42, 112, 182, 252, 112].forEach((sample, frame) => {
          expected.writeInt16LE(sample, frame * 4);
          expected.writeInt16LE(-sample, frame * 4 + 2);
        });
      }
      assert.deepEqual(Buffer.concat(output), expected);
      if (status === 176) assert.equal(stderr, "ffmpeg: chorus: timeline is unsupported\n");
      if (status === 8) assert.equal(stderr, "ffmpeg: chorus: unsupported option bogus\n");
    });
  }
}
