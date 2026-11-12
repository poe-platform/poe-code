import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 reports and byte-identical PCM for buffered resampling.
for (const complex of [false, true]) {
  for (const [rate, bytes, hash, measured, mean, peak, frames = 1, samples = 768] of [
    [4000, 96, "a9bcc6d8958df8c1490132a7cb241bdcabda2c81b5cae55c1433eaa938ca26d1", 160, "-7.7", "-1.6"],
    [16000, 256, "4b6ced249e3a5805c72075be5b1af5e30f7ab387ed057f63367c6863ee8b8d33", 96, "-7.6", "-1.6"],
    [8000, 64, "1b3da4ea1dc1f594cf63d332c9a5b9698bd022bbaef36c25f774f1d9eb89d95b", 32, "-7.8", "-2.6"],
    ["osr=4000", 96, "a9bcc6d8958df8c1490132a7cb241bdcabda2c81b5cae55c1433eaa938ca26d1", 160, "-7.7", "-1.6"],
    [4000, 768, null, 768, "-7.6", "-1.6", null],
    [4000, 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", 48, "-7.6", "-1.6", 1, 48]
  ] as const) {
    it(`counts resampler input at ${rate} Hz (complex=${complex}, frames=${frames}, samples=${samples})`, async () => {
      const input = Buffer.alloc(samples * 2);
      for (let i = 0; i < samples; i++) input.writeInt16LE(((i % 48) * 1433) % 48000 - 20000, i * 2);
      const fs = Volume.fromJSON({ "/in.raw": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const chain = `asetnsamples=n=16:p=0,volumedetect,aresample=${rate}`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          ...(frames === null ? [] : ["-frames:a", String(frames)]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
          async stat(path: string) { return fs.statSync(path); } },
        stdin: (async function* () {})(),
        stdout: { async write(data: Uint8Array) { stdout.push(data.slice()); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(stdout);
      assert.equal(pcm.length, bytes);
      if (hash !== null) assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      assert.equal(stderr, `n_samples: 0\nn_samples: ${measured}\nmean_volume: ${mean} dB\nmax_volume: ${peak} dB\n`);
      assert.deepEqual(fs.readFileSync("/in.raw"), input);
    });
  }
}
