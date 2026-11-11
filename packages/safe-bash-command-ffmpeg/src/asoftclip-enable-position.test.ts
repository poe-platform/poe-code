import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { softClipAudio } from "./audio-asoftclip.js";
import { createFfmpegCommand } from "./index.js";

// Complete s32le output from native FFmpeg 7.0.2; the WAV packet starts at byte 44.
const clipped = "805f3ea700411dbd80251dd3a05a50f460a5af0b80dae22c00bfe24280a0c158";
const bypassed = "0000a0920000c8b5000020d1000048f40000b80b0000e02e0000384a0000606d";
for (const [enable, expected] of [
  ["eq(pos\\,44)", clipped],
  ["eq(pos\\,45)", bypassed],
  ["1", clipped],
  ["0", bypassed]
] as const) for (const graph of [false, true]) {
  it(`asoftclip enable=${enable} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from([-28000, -19000, -12000, -3000, 3000, 12000, 19000, 28000], sample => sample / 32768)
    ] }));
    const filter = `asoftclip=enable=${enable}`;
    const output: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s32le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(Buffer.concat(output).toString("hex"), expected);
  });
}

it("asoftclip evaluates each frame's packet position", async () => {
  const output = await softClipAudio([new Float64Array(6).fill(1)], 8000,
    "asoftclip=type=hard:threshold=0.5:enable=eq(pos,4096)", [
      { start: 0, end: 2, pts: 0, pos: 0 },
      { start: 2, end: 4, pts: 2, pos: 4096 },
      { start: 4, end: 6, pts: 4, pos: 8192 }
    ], "fltp", new MediaBudgetTracker());
  assert.deepEqual(Array.from(output[0]!), [1, 1, 0.5, 0.5, 1, 1]);
});

for (const pos of [undefined, -1]) {
  for (const [enable, expected] of [["isnan(pos)", 0.5], ["pos", 1]] as const) {
    it(`asoftclip evaluates ${enable} with unavailable packet position ${pos}`, async () => {
      const output = await softClipAudio([Float64Array.of(1)], 8000,
        `asoftclip=type=hard:threshold=0.5:enable=${enable}`,
        [{ start: 0, end: 1, pts: 0, ...(pos === undefined ? {} : { pos }) }], "fltp", new MediaBudgetTracker());
      assert.deepEqual(Array.from(output[0]!), [expected]);
    });
  }
}
