import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function runGate(filter: string, programLength = 2048, keyLength = 2048, sampleRate = 8000, stereo = false) {
  const fs = Volume.fromJSON({});
  const program = new Float64Array(programLength).fill(8000 / 32768);
  const key = Float64Array.from({ length: keyLength }, (_, i) => Math.floor(i / 512) % 2 * 20000 / 32768);
  fs.writeFileSync("/a.wav", encodeWav({ sampleRate, channels: stereo ? [program, program.map(x => -x / 2)] : [program] }));
  fs.writeFileSync("/steps.wav", encodeWav({ sampleRate, channels: [key] }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/steps.wav", "-filter_complex",
      `[0:a][1:a]${filter}[o]`, "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  return parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
}

// FFmpeg 7.0.2: 8 kHz WAV frames contain 512 samples; the control steps at each boundary.
it("sidechaingate preserves its first frame for downstream aselect", async () => {
  const audio = await runGate("sidechaingate,aselect=not(n)");
  assert.deepEqual(Array.from(audio.channelData[0]!, x => x * 32768), Array(512).fill(8000));
});

it("sidechaingate preserves all frame indices for downstream volume", async () => {
  const audio = await runGate("sidechaingate,volume=n:eval=frame");
  assert.equal(audio.channelData[0]!.length, 2048);
  assert.deepEqual([0, 512, 1024, 1536].map(i => audio.channelData[0]![i]! * 32768), [0, 4768, 16000, 24000]);
});

it("sidechaingate preserves PCM values through constant downstream volume", async () => {
  const audio = await runGate("sidechaingate,volume=0.5");
  const expected = Array(2048).fill(4000);
  expected[512] = 2384;
  expected[513] = 3763;
  assert.deepEqual(Array.from(audio.channelData[0]!, x => x * 32768), expected);
});

it("sidechaingate preserves frame timestamps for downstream aselect", async () => {
  const audio = await runGate("sidechaingate=ratio=1,aselect=gte(t\\,0.06)");
  assert.deepEqual(Array.from(audio.channelData[0]!, x => x * 32768), Array(1536).fill(8000));
});

for (const [sampleRate, frameSize] of [[8000, 512], [44100, 4096]] as const) {
  for (const shorter of ["program", "key"]) {
    it(`sidechaingate retains a partial final ${sampleRate} Hz frame when ${shorter} ends`, async () => {
      const short = frameSize * 2 + 137;
      const long = frameSize * 3;
      const audio = await runGate("sidechaingate=ratio=1,aselect=eq(n\\,2),volume=0.5",
        shorter === "program" ? short : long, shorter === "key" ? short : long, sampleRate, true);
      assert.equal(audio.sampleRate, sampleRate);
      assert.equal(audio.channels, 2);
      assert.deepEqual(Array.from(audio.channelData[0]!, x => x * 32768), Array(137).fill(4000));
      assert.deepEqual(Array.from(audio.channelData[1]!, x => x * 32768), Array(137).fill(-2000));
    });
  }
}
