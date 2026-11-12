import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM hashes and complete meter reports from native FFmpeg 7.0.2.
for (const [filter, frames, bytes, hash, report] of [
  ["volumedetect,dynaudnorm=f=10:g=3", 1, 160,
    "570ca2c837d57090d97e88d5e8cec42b04bf1f160be2284065cf19ad8f377487",
    "n_samples: 0\nn_samples: 384\nmean_volume: -10.0 dB\nmax_volume: -6.2 dB\n"],
  ["dynaudnorm=f=10:g=3", 1, 160,
    "570ca2c837d57090d97e88d5e8cec42b04bf1f160be2284065cf19ad8f377487", ""],
  ["volumedetect,dynaudnorm=f=10:g=3", undefined, 6144,
    "130ca732c290fc61c60b709a9f6f8c5bed2536111c909c92cd634b94cdaac81f",
    "n_samples: 0\nn_samples: 3072\nmean_volume: -11.9 dB\nmax_volume: -6.2 dB\nhistogram_6db: 128\n"],
  ["volumedetect,anull", 1, 256,
    "099b6e70b201d2d50925ac2f8e7c63d0c5b0a9b50b2adcd6eac246378f4bb761",
    "n_samples: 0\nn_samples: 128\nmean_volume: -30.3 dB\nmax_volume: -30.3 dB\n"],
  ["volumedetect,dynaudnorm=f=10:g=3", 2, 320,
    "8e01c597a998eb77e91e342d5abefd65a2bde6bc64368e3e7f1b49ed63dc21db",
    "n_samples: 0\nn_samples: 512\nmean_volume: -10.5 dB\nmax_volume: -6.2 dB\n"],
  ["volumedetect,dynaudnorm=f=10:g=5", 1, 160,
    "cf7a03edf42358e455309e857ce10979aae9ab9c5978f195860e4c723f061eee",
    "n_samples: 0\nn_samples: 512\nmean_volume: -10.5 dB\nmax_volume: -6.2 dB\n"],
  ["volumedetect,dynaudnorm=f=10:g=3:o=0.5", 8, 640,
    "622fb9df4182951903dd7281d6aae3b2eda381d15703ac5ca961d40b22825300",
    "n_samples: 0\nn_samples: 512\nmean_volume: -10.5 dB\nmax_volume: -6.2 dB\n"],
  ["volumedetect,dynaudnorm=f=10:g=3", 0, 0,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "n_samples: 0\nn_samples: 384\nmean_volume: -10.0 dB\nmax_volume: -6.2 dB\n"]
] as const) {
  it(`counts normalization lookahead for ${filter}, frame limit ${frames}`, async () => {
    const input = Buffer.alloc(3072 * 2);
    for (let i = 0; i < 3072; i++) input.writeInt16LE(i < 128 ? 1000 : i < 256 ? 16000 : 8000, i * 2);
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.raw", input);
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1",
        "-i", "/in.raw", "-af", `asetnsamples=n=128:p=0,${filter}`,
        ...(frames === undefined ? [] : ["-frames:a", String(frames)]), "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(data: Uint8Array) { stdout.push(data.slice()); } },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const pcm = Buffer.concat(stdout);
    assert.equal(pcm.length, bytes);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    assert.equal(stderr, report);
  });
}
