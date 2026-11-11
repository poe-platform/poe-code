import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 keeps PCM16 mixing after highpass, even for float output.
const input = [-32768, 32767, 1, -3, 567, -719, 9501, 6061, -17581, 2131, 8192, -8192];
const pcm = Buffer.from("a8f14c06d304911283e8fd07", "hex");
for (const bridge of ["", "anull,", "aformat=sample_fmts=s16,", "aformat=sample_fmts=s16p,"]) {
  for (const format of ["s16le", "f32le"]) {
    for (const graph of [false, true]) {
      it(`keeps highpass PCM16 pan rounding (${bridge || "implicit"}, ${format}, graph=${graph})`, async () => {
        const wav = encodeWav({ sampleRate: 8000, channels: [0, 1].map(channel =>
          Float64Array.from(input.filter((_, i) => i % 2 === channel), sample => sample / 32768)) });
        const fs = Volume.fromJSON({ "/in.wav": Buffer.from(wav) });
        const filter = `highpass=f=400,${bridge}pan=mono|c0=0.37*c0+0.23*c1`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", format, "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const expected = format === "s16le" ? pcm : Buffer.alloc(pcm.length * 2);
        if (format === "f32le") {
          for (let i = 0; i < pcm.length / 2; i++) expected.writeFloatLE(pcm.readInt16LE(i * 2) / 32768, i * 4);
        }
        assert.deepEqual(fs.readFileSync("/out.raw"), expected);
      });
    }
  }
}
