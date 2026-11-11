import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [options, exitCode] of [
  ["1|0:stereo:", 0],
  ["map=1|0:channel_layout=stereo:", 0],
  ["map=1|0:threads=2:", 0],
  ["1|0:stereo", 0],
  ["1|0:", 0],
  ["1|0:stereo::", 234]
] as const) {
  for (const complex of [false, true]) {
    it(`handles channelmap option terminators (${complex ? "graph" : "simple"}): ${options}`, async () => {
      const input = encodeWav({
        sampleRate: 8000,
        channels: [[100, 200, -300, -400], [1000, -2000, 3000, -4000]]
          .map(samples => Float64Array.from(samples, sample => sample / 32768))
      });
      const volume = new Volume();
      volume.writeFileSync("/pair.wav", input);
      const stdout: Buffer[] = [];
      let stderr = "";
      const filter = `channelmap=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/pair.wav",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
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
      assert.equal(result.exitCode, exitCode, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), exitCode === 0 ? "e803640030f8c800b80bd4fe60f070fe" : "");
      assert.deepEqual(volume.readFileSync("/pair.wav"), Buffer.from(input));
    });
  }
}
