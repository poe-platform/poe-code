import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const mode of ["simple", "graph", "sidechain"] as const) {
  for (const options of [
    "ratio=bad:ratio=2", "ratio=:ratio=2", "ratio=21:ratio=2", "ratio=NaN:ratio=2", "ratio=Infinity:ratio=2", "ratio=2:ratio=bad",
    "threshold=0:threshold=0.125", "attack=0:attack=20", "release=9001:release=250",
    "level_in=0:level_in=1", "makeup=0:makeup=1", "knee=0:knee=2",
    "level_sc=0:level_sc=1", "mix=2:mix=1", "mode=bad:mode=downward",
    "link=2:link=average", "detection=bad:detection=rms",
    "1:downward:0.125:bad:ratio=2", "ratio=3:ratio=2",
    "mode=1:mode=0:link=1:link=0:detection=0:detection=1:ratio=2"
  ]) {
    it(`${mode} compressor validates every occurrence of ${options}`, async () => {
      const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
      const samples = Float64Array.from({ length: 2048 }, (_, i) => i % 8 < 4 ? 0.5 : -0.5);
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
      const valid = options === "ratio=3:ratio=2" || options === "mode=1:mode=0:link=1:link=0:detection=0:detection=1:ratio=2";
      for (const reference of valid ? [true, false] : [false]) {
        const filter = `${mode === "sidechain" ? "sidechaincompress" : "acompressor"}=${reference ? "ratio=2" : options}`;
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-i", "/in.wav", ...(mode === "sidechain" ? ["-i", "/in.wav"] : []),
            ...(mode === "simple" ? ["-af", filter] : ["-filter_complex", `${mode === "sidechain" ? "[0:a][1:a]" : "[0:a]"}${filter}[o]`, "-map", "[o]"]),
            "-c:a", "pcm_s16le", reference ? "/reference.wav" : "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
          stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
        } as never);
        assert.equal(result.exitCode === 0, valid, Buffer.concat(errors).toString());
      }
      if (valid) assert.deepEqual(fs.readFileSync("/out.wav"), fs.readFileSync("/reference.wav"));
      else assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
    });
  }
}
