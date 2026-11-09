import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const expression of ["eq(n\\,1)", "'eq(n,1)'"]) {
  for (const keyLength of [2048, 700]) {
    it(`preserves the second input frame after sidechaincompress with ${expression}, key length ${keyLength}`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 2048 }, (_, i) => i / 32768)] }));
      fs.writeFileSync("/key.wav", encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(keyLength)] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/a.wav", "-i", "/key.wav", "-filter_complex",
          `[0:a][1:a]sidechaincompress,aselect=${expression}[o]`, "-map", "[o]", "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.pcm") as Buffer;
      const expectedLength = Math.min(1024, keyLength) - 512;
      assert.equal(output.length, expectedLength * 2);
      for (let i = 0; i < expectedLength; i++) assert.equal(output.readInt16LE(i * 2), 512 + i);
    });
  }
}
