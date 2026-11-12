import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Complete PCM and meter references from FFmpeg 7.0.2.
for (const [filter, limit, bytes, hash, measurements, inputFrameSize] of [
  ["volumedetect,highpass=f=500:blocksize=256", 1, 512, "1564efbb9379f1cb831a8ae963e14b69585ef03f19d6f9516ac89dc7b9c43c06",
    ["n_samples: 0", "n_samples: 512", "mean_volume: -10.5 dB", "max_volume: -6.2 dB"]],
  ["highpass=f=500:blocksize=256", 1, 512, "1564efbb9379f1cb831a8ae963e14b69585ef03f19d6f9516ac89dc7b9c43c06", []],
  ["volumedetect,highpass=f=500:blocksize=256", undefined, 6144, "67fdf51cb53aa2316a8254193d652717e472bab5cc95f3be6d33a34e94b7f150",
    ["n_samples: 0", "n_samples: 3072", "mean_volume: -11.9 dB", "max_volume: -6.2 dB", "histogram_6db: 128"]],
  ["volumedetect,lowpass=f=500:blocksize=256", 1, 512, "11230da6fc0615dac038ec990b3a8ae99f7f2d57931cc410663cac4cc926195a",
    ["n_samples: 0", "n_samples: 512", "mean_volume: -10.5 dB", "max_volume: -6.2 dB"]],
  ["lowpass=f=500:blocksize=256", 1, 512, "11230da6fc0615dac038ec990b3a8ae99f7f2d57931cc410663cac4cc926195a", []],
  ["volumedetect,lowpass=f=500:blocksize=256", undefined, 6144, "fdb8c26599748e864413ef056df3c1f429908cd01fea48b767675d2e613bc704",
    ["n_samples: 0", "n_samples: 3072", "mean_volume: -11.9 dB", "max_volume: -6.2 dB", "histogram_6db: 128"]],
  ["volumedetect,highpass=f=500:b=256", 2, 1024, "361d22971cc1a6869010f98b48df88bff5f834811cb4d38ea15bf405eaf8b9d2",
    ["n_samples: 0", "n_samples: 1024", "mean_volume: -11.3 dB", "max_volume: -6.2 dB", "histogram_6db: 128"], 1024],
  ["volumedetect,highpass=f=500:b=256", 2, 1024, "361d22971cc1a6869010f98b48df88bff5f834811cb4d38ea15bf405eaf8b9d2",
    ["n_samples: 0", "n_samples: 900", "mean_volume: -11.2 dB", "max_volume: -6.2 dB"], 300],
  ["volumedetect,highpass=f=500:b=256:w=0", 1, 512, "4b0f1ac7bfcd98c0caf9a38bfaa9c5150625bc34ab0a6bf58b14ffee093a0e35",
    ["n_samples: 0", "n_samples: 256", "mean_volume: -9.2 dB", "max_volume: -6.2 dB"], 128],
  ["volumedetect,highpass=f=500:b=256:enable=0", 1, 512, "4b0f1ac7bfcd98c0caf9a38bfaa9c5150625bc34ab0a6bf58b14ffee093a0e35",
    ["n_samples: 0", "n_samples: 512", "mean_volume: -10.5 dB", "max_volume: -6.2 dB"], 128],
  ["volumedetect,anull", 1, 256, "099b6e70b201d2d50925ac2f8e7c63d0c5b0a9b50b2adcd6eac246378f4bb761",
    ["n_samples: 0", "n_samples: 128", "mean_volume: -30.3 dB", "max_volume: -30.3 dB"]]
] as const) {
  for (const graph of [false, true]) it(`matches block-filter PCM and input demand: ${filter}, limit=${limit}, inputFrameSize=${inputFrameSize ?? 128}, graph=${graph}`, async () => {
    const fs = createMemoryFileSystem();
    const input = Buffer.alloc(3072 * 2);
    for (let i = 0; i < 3072; i++) input.writeInt16LE(i < 128 ? 1000 : i < 256 ? 16000 : 8000, i * 2);
    await fs.writeFile("/in.raw", input);
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]asetnsamples=n=${inputFrameSize ?? 128}:p=0,${filter}[out]`, "-map", "[out]"]
          : ["-af", `asetnsamples=n=${inputFrameSize ?? 128}:p=0,${filter}`]),
        ...(limit === undefined ? [] : ["-frames:a", String(limit)]),
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
