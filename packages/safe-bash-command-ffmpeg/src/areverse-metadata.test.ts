import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: tags follow frames, including the short final frame.
for (const complex of [false, true]) {
  for (const reversals of [0, 1, 2]) {
    it(`keeps metadata with audio after ${reversals} reversals (${complex ? "complex" : "simple"})`, async () => {
      const samples = Array.from({ length: 10 }, (_, i) => (i + 1) * 1000);
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      const volume = Volume.fromJSON({ "/in.raw": input, "/tags": "KEEP" });
      const key = "lavfi.astats.Overall.Peak_level";
      const chain = ["asetnsamples=n=3:p=0",
        "astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level",
        ...Array<string>(reversals).fill("areverse"),
        `ametadata=mode=print:key=${key}:file=/tags`].join(",");
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
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
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)),
        reversals === 1 ? samples.slice().reverse() : samples);
      const peaks = ["-20.766309", "-14.745709", "-11.223883", "-10.308734"];
      if (reversals === 1) peaks.reverse();
      const pts = reversals === 1 ? [0, 1, 4, 7] : [0, 3, 6, 9];
      assert.equal(volume.readFileSync("/tags", "utf8"), pts.map((time, n) =>
        `frame:${String(n).padEnd(5)}pts:${String(time).padEnd(7)} pts_time:${time / 8000}\n${key}=${peaks[n]}\n`).join(""));
    });
  }
}
