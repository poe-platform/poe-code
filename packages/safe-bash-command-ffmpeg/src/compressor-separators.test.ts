import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const mode of ["simple", "graph", "sidechain"]) {
  for (const [options, valid] of [
    ["ratio=1", true],
    ["ratio=1:", true],
    ["1:downward:0.125:1:", true],
    ["ratio=1::", false],
    ["ratio=1::makeup=1", false],
    ["ratio=:", false],
    [":", false]
  ] as const) {
    it(`${mode} compressor ${valid ? "accepts" : "rejects"} ${options}`, async () => {
      const fs = Volume.fromJSON({ "/out.pcm": "KEEP" });
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(8).fill(8000 / 32768)] }));
      const filter = `${mode === "sidechain" ? "sidechaincompress" : "acompressor"}=${options}`;
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(mode === "sidechain" ? ["-i", "/in.wav"] : []),
          ...(mode === "simple" ? ["-af", filter]
            : ["-filter_complex", `[0:a]${mode === "sidechain" ? "[1:a]" : ""}${filter}[o]`, "-map", "[o]"]),
          "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode === 0, valid, Buffer.concat(errors).toString());
      if (valid) {
        const expected = Buffer.alloc(16);
        for (let i = 0; i < 8; i++) expected.writeInt16LE(8000, i * 2);
        assert.deepEqual(fs.readFileSync("/out.pcm"), expected);
      } else {
        assert.equal(fs.readFileSync("/out.pcm", "utf8"), "KEEP");
      }
    });
  }
}
