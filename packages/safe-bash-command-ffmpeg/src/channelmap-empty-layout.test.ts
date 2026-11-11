import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [expression, exitCode] of [
  ["map=1|0:channel_layout=", 234],
  ["map=1|0", 0],
  ["map=1|0:channel_layout=stereo", 0]
] as const) {
  for (const complex of [false, true]) {
    it(`handles empty versus omitted channelmap layout (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const volume = new Volume();
      volume.writeFileSync("/pair.wav", encodeWav({
        sampleRate: 8000,
        channels: [[100, 200, -300, -400], [1000, -2000, 3000, -4000]]
          .map(samples => Float64Array.from(samples, sample => sample / 32768))
      }));
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/pair.wav",
          ...(complex ? ["-filter_complex", `[0:a]channelmap=${expression}[s]`, "-map", "[s]"] : ["-af", `channelmap=${expression}`]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), exitCode === 0 ? "e803640030f8c800b80bd4fe60f070fe" : "");
    });
  }
}
