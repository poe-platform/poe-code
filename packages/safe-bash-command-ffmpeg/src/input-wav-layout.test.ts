import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const front = readFileSync(new URL("./fixtures/input-layout-front.wav", import.meta.url));
const plain = readFileSync(new URL("./fixtures/input-layout-plain4.wav", import.meta.url));

async function run(input: Uint8Array, args: string[]) {
  const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.wav": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", ...args, "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
  return { ...result, stderr, volume };
}

// Native FFmpeg 7.0.2 reference samples from these unchanged WAV fixtures.
for (const option of ["-ch_layout", "-channel_layout"]) {
  for (const [input, layout, speaker, expected] of [
    [front, "FC+LFE", "FR", Array.from({ length: 8 }, (_, i) => 1100 + i)],
    [front, "FC+LFE", "LFE", Array(8).fill(0)],
    [front, "mono", "FR", Array.from({ length: 8 }, (_, i) => 1100 + i)],
    [plain, "quad", "BR", Array(8).fill(0)]
  ] as const) {
    it(`preserves WAV speaker assignments with ${option} ${layout} and pan ${speaker}`, async () => {
      for (const options of [[], [option, layout]]) {
        const result = await run(input, [...options, "-i", "/in.wav", "-af", `pan=mono|c0=${speaker}`]);
        assert.equal(result.exitCode, 0, result.stderr);
        const audio = parseWav(result.volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.channels, 1);
        assert.equal(audio.sampleRate, 8000);
        assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), expected);
      }
    });
  }
}

it("falls back from synchronous execution without overwriting output", () => {
  let writes = 0;
  assert.equal(evalSyncFfmpeg(["-y", "-ch_layout", "FC+LFE", "-i", "/in.wav",
    "-af", "pan=mono|c0=FR", "/out.wav"], undefined, () => front,
  () => { writes++; return true; }), undefined);
  assert.equal(writes, 0);
});

for (const layout of ["", "Bogus", "FL+Bogus", "FL+FL"]) {
  it(`rejects invalid input layout ${JSON.stringify(layout)} before overwriting output`, async () => {
    const result = await run(front, ["-ch_layout", layout, "-i", "/in.wav"]);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.volume.readFileSync("/out.wav", "utf8"), "KEEP");
  });
}

it("retains stereo raw-input interpretation", async () => {
  const result = await run(front.subarray(68), ["-f", "s16le", "-ar", "8000", "-ch_layout", "stereo",
    "-i", "/in.wav", "-af", "pan=mono|c0=FR"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const audio = parseWav(result.volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768),
    Array.from({ length: 8 }, (_, i) => 1100 + i));
});

it("routes explicitly assigned raw FC+LFE speakers", async () => {
  const result = await run(front.subarray(68), ["-ch_layout", "FC+LFE", "-f", "s16le", "-ar", "8000",
    "-i", "/in.wav", "-af", "pan=mono|c0=LFE"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const audio = parseWav(result.volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768),
    Array.from({ length: 8 }, (_, i) => 1100 + i));
});

it("does not reinterpret WAV samples or change the channel count without a filter", async () => {
  const result = await run(front, ["-ch_layout", "quad", "-i", "/in.wav"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const audio = parseWav(result.volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  const original = parseWav(front).tracks[0]!.decodedAudio!;
  assert.equal(audio.channels, original.channels);
  assert.deepEqual(audio.channelData, original.channelData);
});

it("resets input layout options before the next raw input", async () => {
  const result = await run(front, ["-ch_layout", "quad", "-i", "/in.wav", "-f", "s16le",
    "-ar", "8000", "-ac", "2", "-i", "/in.wav", "-map", "0:a", "-af", "pan=mono|c0=FR"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const audio = parseWav(result.volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768),
    Array.from({ length: 8 }, (_, i) => 1100 + i));
});
