import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 references include whole frames read ahead by atempo.
for (const [filter, limit, bytes, hash, measurements] of [
  ["volumedetect,atempo=1", 1, 256, "ad4d7657f5e5da76fe60ab79b7af0ef5b94b8c15d29e6c789d9dad51e2319ca8",
    ["n_samples: 0", "n_samples: 512", "mean_volume: -10.5 dB", "max_volume: -6.2 dB"]],
  ["atempo=1", 1, 256, "ad4d7657f5e5da76fe60ab79b7af0ef5b94b8c15d29e6c789d9dad51e2319ca8", []],
  ["volumedetect,atempo=1", undefined, 6108, "c0928034866af7acef548b659fd6dfbe46f222c60da5ea4be4c60a6e8793d0a5",
    ["n_samples: 0", "n_samples: 3072", "mean_volume: -11.9 dB", "max_volume: -6.2 dB", "histogram_6db: 128"]],
  ["volumedetect,atempo=1.5", 1, 170, "3c7c98709d0f594629671d4393bd89dc1859d12d6ad388c9902b7f4894a509b0",
    ["n_samples: 0", "n_samples: 640", "mean_volume: -10.8 dB", "max_volume: -6.2 dB"]],
  ["atempo=1.5", 1, 170, "3c7c98709d0f594629671d4393bd89dc1859d12d6ad388c9902b7f4894a509b0", []],
  ["volumedetect,atempo=1.5", undefined, 4096, "f241aa70acf718a9aa6efc7e37380531c84b8cff05081d186066bb6243463fc6",
    ["n_samples: 0", "n_samples: 3072", "mean_volume: -11.9 dB", "max_volume: -6.2 dB", "histogram_6db: 128"]],
  ["volumedetect,anull", 1, 256, "099b6e70b201d2d50925ac2f8e7c63d0c5b0a9b50b2adcd6eac246378f4bb761",
    ["n_samples: 0", "n_samples: 128", "mean_volume: -30.3 dB", "max_volume: -30.3 dB"]]
] as const) {
  it(`measures atempo input demand without changing PCM: ${filter}, limit=${limit}`, async () => {
    const fs = createMemoryFileSystem();
    const input = Buffer.alloc(3072 * 2);
    for (let i = 0; i < 3072; i++) input.writeInt16LE(i < 128 ? 1000 : i < 256 ? 16000 : 8000, i * 2);
    await fs.writeFile("/in.raw", input);
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", `asetnsamples=n=128:p=0,${filter}`, ...(limit === undefined ? [] : ["-frames:a", String(limit)]),
        "-f", "s16le", "pipe:1"],
      command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    assert.equal(result.exitCode, 0, stderr);
    const output = Buffer.concat(chunks);
    assert.equal(output.length, bytes);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    assert.deepEqual(stderr.split("\n").filter(line => ["n_samples:", "mean_volume:", "max_volume:", "histogram_"]
      .some(prefix => line.startsWith(prefix))), measurements);
  });
}
