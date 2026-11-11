import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 hashes for the same 48-sample WAV.
const inputHash = "75604f234585e206fc03faaf253aecec3035d1b0f0bacdefbf9914f32c485058";
const effectHash = "78406258acdac09d0672721ad3b166b7f00387ba5e39272be0830c28fddbf209";
for (const graph of [false, true]) {
  for (const [options, hash] of [
    ["i=1:s=2", effectHash],
    ["i=1:s=0", inputHash],
    [String.raw`i=1:s=st(0\,2)`, effectHash],
    ["i=1:s=ld(0)", inputHash],
    [String.raw`i=1:s=randomi(0\,2\,2)`, effectHash],
    ["i='st(0,1)':s=ld(0)", inputHash],
    ["i=1:s='st(0,2);ld(0)'", effectHash],
    ["i=1:s='st(0,2)':s=ld(0)", inputHash],
    ["'st(0,1)':0.5:0.5:'randomi(0,2,2)'", effectHash],
    ["i='randomi(0,1,1)':m='st(0,0.5)':f='st(0,0.5)':s=2", effectHash]
  ]) {
    it(`deesser stateful options match native (graph=${graph}): ${options}`, async () => {
      const fs = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({
        sampleRate: 48000,
        channels: [Float64Array.from({ length: 48 }, (_, i) => (i * 7919 % 50000 - 25000) / 32768)]
      }, { bitsPerSample: 16 })) });
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const filter = `deesser=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = Buffer.concat(chunks);
      assert.equal(output.length, 96);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
