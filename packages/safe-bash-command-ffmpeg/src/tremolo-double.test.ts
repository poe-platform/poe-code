import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// SHA-256 of f64le output from native FFmpeg 7.0.2, including the full oscillator cycle.
for (const [filter, frames, rate, channels, hash] of [
  ["tremolo=f=13:d=0.6", 16, 1000, 1, "682f57f86c7f53ae2c784591d46e417f3a25a01d64f39a48117bab5fe43cdacd"],
  ["asetnsamples=n=7:p=0,tremolo=f=13:d=0.6", 308, 1000, 1, "d66f971b9c6b9fb38ad45ddbb7fbcc111cf962a6f797013b4ea519f26b72eab9"],
  ["tremolo=f=13:d=0.6", 154, 1000, 2, "196fa83ba64e618e9ee8ea0a10ac9e5602c07bb16f4e7580c593816fc509333d"],
  ["tremolo=f=5:d=0.6", 2000, 8000, 1, "98b3014e84e90338d53fa8532a9fa784bddfa02edd75b2e2fecf4d79070c27c9"],
  ["tremolo=f=7.3:d=0.6", 2000, 8000, 1, "4dad759dbdbff7768712c3f534b20860b71f1bb5695e5c279e07db255c529fd7"],
  ["tremolo=f=13:d=0.6:enable=0", 16, 1000, 1, "a5ead0830da49a19ac2ab1da77c6b0f071f728d1bc7e9dc9afd8f07ce4d622f4"]
] as const) {
  for (const complex of [false, true]) {
    it(`${filter} matches ${frames} native double PCM frames, ${channels} channel(s) (${complex ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(frames * channels * 8);
      for (let i = 0; i < frames * channels; i++) input.writeDoubleLE([0, .123456789, -.34567891, .77777777][i % 4]!, i * 8);
      const volume = Volume.fromJSON({ "/in.pcm": input });
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "f64le", "-ar", String(rate), "-ac", String(channels), "-i", "/in.pcm",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
            : ["-af", filter]), "-f", "f64le", "pipe:1"],
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
      assert.equal(pcm.length, input.length);
      if (rate === 1000 && channels === 1 && !filter.includes("enable=0")) {
        assert.equal(pcm.subarray(9 * 8, 10 * 8).toString("hex"), "65c60a240128bd3f");
      }
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}
