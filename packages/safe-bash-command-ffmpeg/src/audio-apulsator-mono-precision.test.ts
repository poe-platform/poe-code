import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete interleaved PCM32 output from FFmpeg 7.0.2 for this PCM16 fixture.
const expected = [23193646, 23193646, -46390536, -46245024, 69730, 69293,
  488873, 484287, 116650242, 115193534, 0, 0, 444388, 436090, -163977, -160410];

for (const graph of [false, true]) {
  for (const conversion of ["", "aformat=sample_fmts=dblp:channel_layouts=stereo,"]) {
    it(`matches native mono apulsator PCM32 (graph=${graph}, conversion=${conversion})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from([1001, -1999, 3, 21, 5003, 0, 19, -7], value => value / 32768)] }));
      const filter = `${conversion}apulsator=hz=2`;
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", "pcm_s32le", "-f", "s32le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0);
      assert.equal(stderr, "");
      const output = Buffer.concat(stdout);
      assert.equal(output.length, expected.length * 4);
      assert.deepEqual(expected.map((_, index) => output.readInt32LE(index * 4)), expected);
    });
  }
}
