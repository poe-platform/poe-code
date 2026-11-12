import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 pcm_s16le output, including the silent control.
for (const [spec, count, expected, digest] of [
  ["sine=r=8000:d=0.25:f=1000", 2000, [0, 2896, 4095, 2896, 0, -2896, -4095, -2896],
    "85a88028b9dd522e997d28a826831c0bc95764b6960f3055666861c6cdb50c6f"],
  ["sine=r=8000:d=0.25:f=400", 2000, [0, 1265, 2406, 3313, 3895, 4095, 3895, 3313],
    "87a9f5256fa059c2f5b8a3dd2937598cc2090e3dbf638bbab0c12dfbd24e7215"],
  ["sine=r=8000:d=0.25:f=0", 2000, [0, 0, 0, 0, 0, 0, 0, 0],
    "fc19b1997119425765295aeab72d76faa6927d4f83985d328c26f20468d6cc76"],
  // One cycle visits every lookup-table entry; other rates exercise phase wrapping.
  ["sine=frequency=1:sample_rate=32768:duration=1", 32768, [],
    "c575dee170b8d7169ee2e4e4098470bd1a58acbe8b98cdec74476d3c85b9632c"],
  ["sine=frequency=440:sample_rate=44100:duration=0.25", 11025, [],
    "8b1ba60c552884d9ffb50d890687ca9c41107e2ae402291de19b0a6ac9d5cf0d"],
  ["sine=frequency=123.45:sample_rate=48000:duration=0.25", 12000, [],
    "8c2077e09d8f7dfdc6042dad54e185c751b9d07931dc891c64575b524a21844a"]
] as const) {
  it(`matches native PCM for ${spec}`, async () => {
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "lavfi", "-i", spec,
        "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal, fs: {},
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    const pcm = Buffer.concat(chunks);
    assert.equal(pcm.length, count * 2);
    const samples = Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2));
    assert.deepEqual(samples.slice(0, expected.length), expected);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), digest);
  });
}
