import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const samples = [1, 2, 3, 4, 5, 6];

// Native FFmpeg 7.0.2 retains the samples and starts them at 2 ms after -ss -0.002.
for (const copyts of [false, true]) {
  for (const [input, output, expected, pts] of [
    [["-ss", "-0.002"], ["-ss", "0.003"], samples.slice(copyts ? 3 : 1), undefined],
    [["-ss", "-0.002"], ["-af", "atrim=start=0.003"], samples.slice(copyts ? 3 : 1), undefined],
    [["-ss", "-0.002"], ["-filter_complex", "[0:a]atrim=start=0.003[out]", "-map", "[out]"], samples.slice(copyts ? 3 : 1), undefined],
    [["-ss", "-0.002"], ["-af", "ashowinfo"], samples, 2],
    [[], ["-ss", "0.003"], [4, 5, 6], undefined],
    [["-ss", "-0.002"], [], samples, undefined]
  ] as const) {
    it(`preserves negative input seek timing: ${copyts ? "-copyts " : ""}${input.join(" ")} ${output.join(" ")}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000,
        channels: [Float64Array.from(samples, sample => sample / 32768)] }));
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", ...(copyts ? ["-copyts"] : []), ...input, "-i", "/in.wav",
          ...output, "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const bytes = Buffer.concat(chunks);
      assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)), expected);
      if (pts !== undefined) {
        const frames = stderr.split("\n").filter(line => line.startsWith("[ashowinfo]"));
        assert.equal(frames.length, 1, stderr);
        assert.ok(frames[0]!.includes(`pts:${copyts ? 0 : pts} pts_time:${copyts ? 0 : pts / 1000} `), stderr);
        assert.ok(frames[0]!.includes("nb_samples:6"), stderr);
      }
    });
  }

  it(`preserves all PCM samples on a synchronous negative input seek (copyts=${copyts})`, () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000,
      channels: [Float64Array.from(samples, sample => sample / 32768)] }));
    const result = evalSyncFfmpeg(["-v", "error", ...(copyts ? ["-copyts"] : []),
      "-ss", "-0.002", "-i", "/in.wav", "-f", "s16le", "/out.raw"], undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
    assert.equal(result, "");
    const bytes = volume.readFileSync("/out.raw") as Buffer;
    assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)), samples);
  });
}
