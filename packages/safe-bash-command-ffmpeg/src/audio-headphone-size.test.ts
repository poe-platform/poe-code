import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output for 2400 stereo samples and a three-tap HRIR.
const cases = [
  { size: 2048, filter: "aselect=not(n)", bytes: 8192,
    sha256: "c328ee5c539b725d3f61d87438c933e289ddfaee71b3b392ac7133592a601529" },
  { size: 2048, filter: "aselect=n", bytes: 1408,
    sha256: "ee474b480ae2eb2eba012c7783e6d5bf2ddf553954ec27fa346198f258c0a380" },
  { size: 1024, filter: "aselect=not(n)", bytes: 4096,
    sha256: "47ac6d4e89c8fb4154b400ce8970099e7885cd13656e84c863a900750c5bae5f" },
  { size: 2048, filter: "anull", bytes: 9600,
    sha256: "0185b11d85494a6ed94cf228b0971bd0402a84588701327f51793fbc325b2a05" }
];

for (const type of ["time", "freq"]) {
  for (const { size, filter, bytes, sha256 } of cases) {
    it(`headphone type=${type}:size=${size},${filter} preserves native blocks and PCM`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(2400).fill(5000 / 32768), new Float64Array(2400).fill(-1000 / 32768)] }));
      volume.writeFileSync("/ir.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from([16384, 0, 4096], x => x / 32768),
          Float64Array.from([0, 8192, 4096], x => x / 32768)] }));
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", "-i", "/ir.wav", "-i", "/ir.wav",
          "-filter_complex", `[0:a][1:a][2:a]headphone=map=FL|FR:type=${type}:size=${size},${filter}[o]`,
          "-map", "[o]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(data: Uint8Array) { output.push(data); } },
        stderr: { async write(data: Uint8Array) { errors.push(data); } }
      } as never);
      const error = Buffer.concat(errors).toString();
      assert.equal(result.exitCode, 0, error);
      assert.equal(error, "");
      const pcm = Buffer.concat(output);
      assert.equal(pcm.length, bytes);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), sha256);
    });
  }
}
