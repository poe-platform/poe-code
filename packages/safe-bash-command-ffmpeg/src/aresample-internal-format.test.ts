import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function convert(filter: string, graph = false, options: string[] = []) {
  const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: Array.from({ length: 2 }, (_, c) =>
      Float64Array.from({ length: 8000 }, (_, i) => ((i * 997 + c * 149) % 60001 - 30000) / 32768)) }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      ...options, "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.pcm") as Buffer };
}

// Native FFmpeg 7.0.2: full-output SHA-256 hashes for stereo PCM16 at 8 -> 16 kHz.
for (const key of ["tsf", "internal_sample_fmt"]) {
  for (const [format, hash] of [["fltp", "593ea20a54bf414d15ab319a248142c20de622738a723da51d2997005ff90ad9"], ["dblp", "42b3f09f4c723375d5c5422e3b6bf5801fa7f3b0b77e7888dea4a85e9c4777c9"]]) {
    for (const graph of [false, true]) it(`resamples with ${key}=${format} (${graph ? "graph" : "simple"})`, async () => {
      const result = await convert(`aresample=16000:${key}=${format}`, graph);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.length, 64000);
      assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
    });
  }
  for (const value of ["", "bad", "flt", "dbl", "dblp=1"]) {
    it(`rejects invalid internal format ${key}=${value} without replacing output`, async () => {
      const result = await convert(`aresample=16000:${key}=${value}`);
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.output.toString(), "KEEP");
      assert.ok(result.stderr.includes("sample format"), result.stderr);
    });
  }
}

for (const [filter, options, bytes, hash] of [
  ["flanger,aresample=16000:tsf=fltp", [], 64000, "a11ce831dc321fb23e682d7484ad049760e7bfd373f15082f2254a52ecdef389"],
  ["aresample=tsf=dblp", ["-ar", "16000"], 64000, "42b3f09f4c723375d5c5422e3b6bf5801fa7f3b0b77e7888dea4a85e9c4777c9"],
  ["aresample=16000:tsf=dblp:osf=fltp", [], 64000, "42b3f09f4c723375d5c5422e3b6bf5801fa7f3b0b77e7888dea4a85e9c4777c9"],
  ["aresample=16000:tsf=dblp:osf=s16", [], 64000, "42b3f09f4c723375d5c5422e3b6bf5801fa7f3b0b77e7888dea4a85e9c4777c9"],
  ["aresample=16000:tsf=fltp:internal_sample_fmt=dblp", [], 64000, "42b3f09f4c723375d5c5422e3b6bf5801fa7f3b0b77e7888dea4a85e9c4777c9"],
  ["aresample=16000:tsf=dblp:internal_sample_fmt=fltp", [], 64000, "593ea20a54bf414d15ab319a248142c20de622738a723da51d2997005ff90ad9"],
  ["aresample=8000:tsf=dblp", [], 32000, "e45aad66c9acd820f32ecd4da1e3166e23e583803bbc354881b8b3c3179ad276"],
  ["aresample=4000:tsf=dblp", [], 16000, "f66c3c4ddc9964b9b60fff6f785c401f940213347e86d02495f4563940b825ea"],
  ["aresample=11025:tsf=dblp", [], 44100, "98bfe862de1aecc56e90f58cc050bdd94345c9202646730333d6ea1aa14e46b2"]
] as const) {
  it(`honors precision and output negotiation for ${filter} ${options.join(" ")}`, async () => {
    const result = await convert(filter, false, [...options]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, bytes);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}
