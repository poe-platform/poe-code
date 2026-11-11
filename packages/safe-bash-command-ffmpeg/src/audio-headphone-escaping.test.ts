import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const type of ["time", "freq"]) {
  for (const expression of ["n", "eq(n\\,1)", "'eq(n,1)'"]) {
    it(`headphone ${type} preserves aselect=${expression} and following filters`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(1200).fill(5000 / 32768), new Float64Array(1200).fill(-1000 / 32768)] }));
      volume.writeFileSync("/ir.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from([16384, 0, 4096], x => x / 32768),
          Float64Array.from([0, 8192, 4096], x => x / 32768)] }));
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", "-i", "/ir.wav", "-i", "/ir.wav",
          "-filter_complex", `[0:a][1:a][2:a]headphone=map=FL|FR:type=${type}:size=1024,aselect=${expression},anull[o]`,
          "-map", "[o]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      const error = Buffer.concat(errors).toString();
      assert.equal(result.exitCode, 0, error);
      assert.equal(error, "");
      const pcm = Buffer.concat(output);
      // Native FFmpeg 7.0.2: the second 1024-sample block contains 176 stereo frames.
      assert.equal(pcm.length, 704);
      assert.equal(createHash("sha256").update(pcm).digest("hex"),
        "d50cff35a6ff70be0f7bd679439b1bef0e1eb7fd0b7db3ade0ec94a09bd8da7e");
    });
  }
}
