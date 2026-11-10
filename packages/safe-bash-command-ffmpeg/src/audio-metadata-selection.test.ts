import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 reference: ten PCM16 samples, framed in groups of three.
const peaks = ["-20.766309", "-14.745709", "-11.223883", "-10.308734"];
for (const complex of [false, true]) {
  for (const [filter, samples, frames] of [
    ["anull", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [[0, 0], [1, 3], [2, 6], [3, 9]]],
    ["atrim=start_sample=3", [4, 5, 6, 7, 8, 9, 10], [[1, 3], [2, 6], [3, 9]]],
    ["aselect='not(eq(n,1))'", [1, 2, 3, 7, 8, 9, 10], [[0, 0], [2, 6], [3, 9]]],
    ["atrim=start_sample=4:end_sample=8", [5, 6, 7, 8], [[1, 4], [2, 6]]],
    ["atrim=end_sample=0", [], []],
    ["aselect=0", [], []],
    ["aselect='not(eq(n,1))',atrim=start_sample=4", [8, 9, 10], [[2, 7], [3, 9]]]
  ] as const) {
    it(`keeps metadata with surviving frames: ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(20);
      for (let i = 0; i < 10; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/tags": "KEEP" });
      const chain = `asetnsamples=n=3:p=0,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level,${filter},ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file=tags`;
      let stderr = "";
      const output: Buffer[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[o]`, "-map", "[o]"] : ["-af", chain]),
          "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(output);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), samples.map(n => n * 1000));
      assert.equal(volume.readFileSync("/tags", "utf8"), frames.map(([source, pts], n) =>
        `frame:${String(n).padEnd(5)}pts:${String(pts).padEnd(7)} pts_time:${pts / 8000}\nlavfi.astats.Overall.Peak_level=${peaks[source]}\n`).join(""));
    });
  }
}
