import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 status and complete interleaved PCM16 output.
const cases = [
  ["FL+FR", 0, "8c3ce4da30f85046d68962435e1a7ac2"],
  ["DL+DR", 0, "8c3ce4da30f85046d68962435e1a7ac2"],
  ["FR+FL", 234, ""],
  ["FC+LFE", 0, "191619160c0b0c0bced3ced300000000"],
  ["BL+BR", 234, ""]
] as const;

for (const graph of [false, true]) {
  for (const [layout, status, hex] of cases) {
    const filter = `channelmap=0|1:${layout},extrastereo`;
    it(`${filter} matches native layout negotiation (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 16000,
        channels: [[8000, 4000, -16000, 0], [-2000, 12000, 3000, -9000]]
          .map(samples => Float64Array.from(samples, value => value / 32768)) }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { void bytes; } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, status, stderr);
      assert.equal(volume.readFileSync("/out.raw").toString("hex"), hex);
    });
  }
}

for (const graph of [false, true]) {
  it(`widens pan downmix speakers to stereo (${graph ? "graph" : "simple"})`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [[1000, 1083, 1166, 1249], [-3000, -2903, -2806, -2709]]
        .map(samples => Float64Array.from(samples, value => value / 32768)) }));
    const filter = "pan=DL+DR|c0=c0|c1=c1,extrastereo";
    let stderr = "";
    const stdout: Buffer[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    const pcm = Buffer.concat(stdout);
    assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, index) => pcm.readInt16LE(index * 2)),
      [4000, -6000, 4072, -5892, 4145, -5785, 4218, -5678]);
  });
}
