import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const channels of [1, 2]) {
  for (const [start, end, outpoint] of [
    [2000, 8000, undefined],
    [2048, 8000, undefined],
    [2000, 6096, 0.75],
    [8000, 8000, undefined]
  ] as const) {
    it(`concat PCM copy seeks to frame ${start}, channels ${channels}, outpoint ${outpoint}`, async () => {
      const volume = Volume.fromJSON({
        "/list.ffconcat": `ffconcat version 1.0\nfile a.wav\ninpoint ${start / 8000}\n${outpoint === undefined ? "" : `outpoint ${outpoint}\n`}file b.wav\n`,
        "/out.bin": "keep"
      });
      for (const name of ["a", "b"]) {
        volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
          channels: Array.from({ length: channels }, (_, channel) =>
            Float64Array.from({ length: 8000 }, (_, i) => (name === "a" ? i + channel * 8000 : -2000 - channel) / 32768)) }));
      }
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-segment_time_metadata", "1", "-i", "/list.ffconcat", "-c:a", "copy", "-f", "s16le", "/out.bin"],
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
      const expected = Buffer.alloc((end - start + 8000) * channels * 2);
      for (let frame = 0; frame < end - start + 8000; frame++) {
        for (let channel = 0; channel < channels; channel++) {
          expected.writeInt16LE(frame < end - start ? start + frame + channel * 8000 : -2000 - channel,
            (frame * channels + channel) * 2);
        }
      }
      const actual = volume.readFileSync("/out.bin") as Buffer;
      assert.equal(actual.length, expected.length);
      assert.equal(actual.readInt16LE(), expected.readInt16LE());
      assert.deepEqual(actual, expected);
    });
  }
}
