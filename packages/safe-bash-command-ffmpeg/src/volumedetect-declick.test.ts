import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM hashes and meter values from native FFmpeg 7.0.2.
for (const [filter, limit, bytes, hash, measured, mean] of [
  ["volumedetect,adeclick", 1, 220, "94f89167b393a460739689df7c37e439f85b56e5dad30aba331f6358502dc53e", 512, "-10.5"],
  ["adeclick", 1, 220, "94f89167b393a460739689df7c37e439f85b56e5dad30aba331f6358502dc53e", undefined, undefined],
  ["volumedetect,adeclick", undefined, 6144, "abc87e639b9ceb51da1c3dfb5cbdd2b97343a27c27419c0c42bd53c7c6db52c9", 3072, "-11.9"],
  ["volumedetect,adeclip", 1, 220, "94f89167b393a460739689df7c37e439f85b56e5dad30aba331f6358502dc53e", 512, "-10.5"],
  ["adeclip", 1, 220, "94f89167b393a460739689df7c37e439f85b56e5dad30aba331f6358502dc53e", undefined, undefined],
  ["volumedetect,adeclip", undefined, 6144, "d10edbad6a30f0d10cafbea36c8eb572cbb7bee796504c55e74c8a70e27debb7", 3072, "-11.9"],
  ["volumedetect,anull", 1, 256, "099b6e70b201d2d50925ac2f8e7c63d0c5b0a9b50b2adcd6eac246378f4bb761", 128, "-30.3"]
] as const) {
  it(`measures declick and declip frame demand: ${filter}, limit ${limit}`, async () => {
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
      ...(measured !== 3072 ? [] : ["histogram_6db: 128"])]);
  });
}
