import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete PCM and meter output captured with native FFmpeg 7.0.2.
for (const [filter, capped, normalized, metered] of [
  ["volumedetect,loudnorm", true, true, true],
  ["loudnorm", true, true, false],
  ["volumedetect,loudnorm", false, true, true],
  ["volumedetect,anull", true, false, true]
] as const) {
  it(`matches native short-clip frames for ${filter}, capped=${capped}`, async () => {
    const input = Buffer.alloc(3072 * 2);
    for (let i = 0; i < 3072; i++) input.writeInt16LE(i < 128 ? 1000 : i < 256 ? 16000 : 8000, i * 2);
    const volume = Volume.fromJSON({ "/in.raw": input });
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", `asetnsamples=n=128:p=0,${filter}`, ...(capped ? ["-frames:a", "1"] : []), "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const pcm = Buffer.concat(chunks);
    assert.equal(pcm.length, normalized ? 147456 : 256);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), normalized
      ? "f0abbf145790cacb3e3c498afdf31e403dc2066053c041c78b1058adbbb7a4d2"
      : "099b6e70b201d2d50925ac2f8e7c63d0c5b0a9b50b2adcd6eac246378f4bb761");
    assert.deepEqual(stderr.split("\n").filter(line => ["n_samples:", "mean_volume:", "max_volume:", "histogram_"].some(prefix => line.startsWith(prefix))),
      !metered ? [] : normalized
        ? ["n_samples: 0", "n_samples: 3072", "mean_volume: -11.9 dB", "max_volume: -6.2 dB", "histogram_6db: 128"]
        : ["n_samples: 0", "n_samples: 128", "mean_volume: -30.3 dB", "max_volume: -30.3 dB"]);
  });
}
