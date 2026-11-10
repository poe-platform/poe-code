import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: all 32 six-channel PCM16 frames at 8000 Hz.
for (const [format, left, right] of [
  ["", 8586, -2343],
  [":sample_fmts=dbl", 8586, -2343],
  [":sample_fmts=s16", 3556, -971],
  [":f=s16", 3556, -971]
] as const) {
  const filter = `aformat=channel_layouts=stereo${format},apulsator=amount=0`;
  for (const graph of [false, true]) {
    it(`matches PCM16 rounding for ${filter} (graph=${graph})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [10000, -8000, 2000, 1000, -4000, 6000].map(sample =>
          new Float64Array(32).fill(sample / 32768)) }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      const expected = Buffer.alloc(128);
      for (let frame = 0; frame < 32; frame++) {
        expected.writeInt16LE(left, frame * 4);
        expected.writeInt16LE(right, frame * 4 + 2);
      }
      assert.deepEqual(output, expected);
    });
  }
}
