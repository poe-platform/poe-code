import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

for (const filter of ["acontrast=50:", "acontrast=contrast=50:", "acontrast=50", "acontrast=contrast=50", "acontrast=", "acontrast=50::", "acontrast=contrast=50::", "acontrast=:"]) {
  for (const graph of [false, true]) {
    it(`${filter} matches native raw PCM and output preservation (${graph ? "graph" : "simple"})`, async () => {
      const fs = createMemoryFileSystem();
      const samples = [-30000, -12345, -401, -1, 0, 1, 401, 12345, 30000];
      const bytes = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
      await fs.writeFile("/in.raw", bytes);
      await fs.writeFile("/out.raw", Buffer.from("KEEP"));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      const output = Buffer.from(await fs.readFile("/out.raw"));
      if (filter.endsWith("::") || filter === "acontrast=:") {
        assert.notEqual(result.exitCode, 0);
        assert.equal(output.toString(), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        // Native FFmpeg 7.0.2 PCM16LE reference samples.
        const expected = filter === "acontrast="
          ? [-32375, -19107, -741, -2, 0, 2, 741, 19107, 32375]
          : [-32315, -19527, -798, -2, 0, 2, 798, 19527, 32315];
        const expectedBytes = Buffer.alloc(expected.length * 2);
        expected.forEach((sample, index) => expectedBytes.writeInt16LE(sample, index * 2));
        assert.deepEqual(output, expectedBytes);
      }
    });
  }
}

// Native FFmpeg 9.0.1 decoded PCM16 samples, 8 kHz stereo.
const input = [-32768, -30000, -24000, -16000, -12000, -8000, -4000, -400, -1, 0, 1, 400, 4000, 8000, 12000, 16000, 24000, 30000, 32767];
for (const [filter, expected] of [
  ["acontrast=contrast=50", [-32768, -32315, -28965, -22855, -19170, -14256, -7726, -796, -2, 0, 2, 796, 7726, 14256, 19170, 22855, 28965, 32315, 32767]],
  ["acontrast", [-32768, -32375, -29303, -22816, -18719, -13584, -7224, -739, -2, 0, 2, 739, 7224, 13584, 18719, 22816, 29303, 32375, 32767]],
  ["acontrast=0", [-32768, -32480, -29916, -22740, -17827, -12261, -6245, -628, -2, 0, 2, 628, 6245, 12261, 17827, 22740, 29916, 32480, 32767]],
  ["acontrast=100", [-32768, -32114, -27887, -22970, -20466, -16189, -9190, -963, -2, 0, 2, 963, 9190, 16189, 20466, 22970, 27887, 32114, 32767]],
  ["acontrast=12.5", [-32768, -32442, -29690, -22769, -18167, -12765, -6616, -670, -2, 0, 2, 670, 6616, 12765, 18167, 22769, 29690, 32442, 32767]]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native PCM and rate (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData.length, 2);
      assert.equal(audio.channelData[0]!.length, input.length);
      for (let i = 0; i < input.length; i++) {
        for (let c = 0; c < 2; c++) {
          const sample = Math.round(audio.channelData[c]![i]! * 32768);
          // Native sinf and PCM rounding can differ by one least-significant bit.
          assert.ok(Math.abs(sample - expected[c === 0 ? i : input.length - 1 - i]!) <= 1, `${filter} channel ${c} sample ${i}: ${sample}`);
        }
      }
    });
  }
}

for (const filter of ["acontrast=contrast=-1", "acontrast=101", "acontrast=NaN", "acontrast=Infinity", "acontrast=contrast=", "acontrast=unknown=1", "acontrast=1:2"]) {
  it(`${filter} rejects invalid options without replacing output`, async () => {
    const { volume, result } = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

for (const graph of [false, true]) {
  for (const [filter, status] of [
    ["acontrast=bad", 234], ["acontrast=-1", 222], ["acontrast=101", 222],
    ["acontrast=enable=1", 176], ["acontrast=unknown=1", 8], ["acontrast=contrast=50", 0]
  ] as const) {
    it(`${filter} matches native status and raw output (${graph ? "graph" : "simple"})`, async () => {
      const pcm = Buffer.alloc(18);
      [-30000, -12345, -401, -1, 0, 1, 401, 12345, 30000].forEach((value, i) => pcm.writeInt16LE(value, i * 2));
      const volume = Volume.fromJSON({ "/out.raw": "KEEP", "/in.raw": pcm });
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
      } as never);
      assert.equal(result.exitCode, status);
      const expected = status === 0 ? Buffer.alloc(18) : Buffer.from("KEEP");
      if (status === 0) {
        [-32315, -19527, -798, -2, 0, 2, 798, 19527, 32315].forEach((value, i) => expected.writeInt16LE(value, i * 2));
      }
      assert.deepEqual(volume.readFileSync("/out.raw"), expected);
    });
  }
}

it("matches the native 7200-sample mono gain transfer", async () => {
  const samples = [[0, 600], [400, 1600], [12000, 1600], [0, 800], [4000, 1600], [0, 1000]]
    .flatMap(([amplitude, length]) => Array.from({ length: length! }, (_, i) => (i % 2 ? -amplitude! : amplitude!) / 32768));
  const { volume, result, stderr } = await run("acontrast=contrast=50", false, [Float64Array.from(samples)]);
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 8000);
  assert.equal(audio.channelData.length, 1);
  assert.equal(audio.channelData[0]!.length, 7200);
  for (const [index, expected] of [[0, 0], [600, 796], [601, -796], [2200, 19170], [2201, -19170], [3800, 0], [4600, 7726], [4601, -7726], [7199, 0]]) {
    assert.equal(Math.round(audio.channelData[0]![index!]! * 32768), expected);
  }
});

async function run(filter: string, graph = false, channels = [
    Float64Array.from(input, value => value / 32768),
    Float64Array.from([...input].reverse(), value => value / 32768)
  ]) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 3 } }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr };
}
