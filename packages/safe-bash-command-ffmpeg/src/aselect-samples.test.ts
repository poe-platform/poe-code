import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM expected from the reported FFmpeg 7.0.2 fixture, with three-sample frames.
const samples = [101, 114, 127, 140, 153, 166, 179, 192, 205, 218];
for (const complex of [false, true]) {
  for (const channels of [1, 2]) {
    for (const [expression, expected] of [
      ["eq(samples_n,1)", samples.slice(9)],
      ["eq(samples_n,3)", samples.slice(0, 9)],
      ["eq(sample_rate,8000)", samples],
      ["eq(consumed_samples_n,3)", []],
      ["isnan(consumed_samples_n)", samples],
      ["eq(n,1)", samples.slice(3, 6)]
    ] as const) {
      it(`aselect=${expression} (${channels} channels, ${complex ? "complex" : "simple"})`, async () => {
        const input = Buffer.alloc(samples.length * channels * 2);
        for (const [i, sample] of samples.entries()) {
          for (let channel = 0; channel < channels; channel++) {
            input.writeInt16LE(channel === 0 ? sample : -sample, (i * channels + channel) * 2);
          }
        }
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.dat": "KEEP" });
        const chain = `asetnsamples=n=3:p=0,aselect='${expression}'`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${chain}[o]`, "-map", "[o]"] : ["-af", chain]),
            "-f", "s16le", "/out.dat"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.dat") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          expected.flatMap(sample => channels === 1 ? [sample] : [sample, -sample]));
      });
    }
  }
}
