import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM hashes and meter values from native FFmpeg 7.0.2.
for (const [filter, limit, bytes, hash, measured, mean] of [
  ["volumedetect,afwtdn=samples=512", 1, 870, "528ce9c21410f4aa8bb945ea18ce060d0c4a81956ea1622e1a036cc8906c88af", 1024, "-11.3"],
  ["afwtdn=samples=512", 1, 870, "528ce9c21410f4aa8bb945ea18ce060d0c4a81956ea1622e1a036cc8906c88af", undefined, undefined],
  ["volumedetect,afwtdn=samples=512", undefined, 6144, "8670ac941c93291c455aad8a189f9a17f7197e655e905b559b4b815c38c0557c", 3072, "-11.9"],
  ["volumedetect,afwtdn", 1, 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", 3072, "-11.9"],
  ["afwtdn", 1, 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", undefined, undefined],
  ["volumedetect,afwtdn", undefined, 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", 3072, "-11.9"],
  ["volumedetect,anull", 1, 256, "099b6e70b201d2d50925ac2f8e7c63d0c5b0a9b50b2adcd6eac246378f4bb761", 128, "-30.3"]
] as const) {
  it(`measures buffered wavelet input: ${filter}, limit ${limit}`, async () => {
    const input = Buffer.alloc(3072 * 2);
    for (let i = 0; i < 3072; i++) input.writeInt16LE(i < 128 ? 1000 : i < 256 ? 16000 : 8000, i * 2);
    const fs = Volume.fromJSON({ "/in.raw": input });
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", `asetnsamples=n=128:p=0,${filter}`,
        ...(limit === undefined ? [] : ["-frames:a", String(limit)]), "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); } },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = Buffer.concat(chunks);
    assert.equal(output.length, bytes);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    const meters = stderr.split("\n").filter(line => ["n_samples:", "mean_volume:", "max_volume:", "histogram_"].some(prefix => line.startsWith(prefix)));
    assert.deepEqual(meters, measured === undefined ? [] : ["n_samples: 0", `n_samples: ${measured}`,
      `mean_volume: ${mean} dB`, `max_volume: ${measured === 128 ? "-30.3" : "-6.2"} dB`,
      ...(measured === 128 ? [] : ["histogram_6db: 128"])]);
  });
}
