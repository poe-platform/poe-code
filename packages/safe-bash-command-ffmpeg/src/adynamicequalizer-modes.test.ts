import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { listenDynamicEqualizer } from "./audio-adynamicequalizer.js";
import { createFfmpegCommand } from "./index.js";

// Python random.Random(45): 8192 randrange(-32768, 32768) samples, mono PCM16 at 16 kHz.
const input = readFileSync(new URL("./fixtures/adynamicequalizer-modes-input.wav", import.meta.url));
// FFmpeg 7.0.2: -i input.wav -af adynamicequalizer=mode=MODE -c:a pcm_s16le out.wav.
// With the default zero threshold, boostbelow and cutbelow produce the same PCM.
for (const [mode, fixture] of [
  ["", "cutbelow"], ["cutbelow", "cutbelow"], ["0", "cutbelow"],
  ["cutabove", "cutabove"], ["1", "cutabove"],
  ["boostbelow", "cutbelow"], ["2", "cutbelow"],
  ["boostabove", "boostabove"], ["3", "boostabove"]]) {
  for (const graph of [false, true]) {
    it(`matches every native PCM sample for ${mode || "default"} (${graph ? "graph" : "simple"})`, async () => {
      const filter = `adynamicequalizer${mode ? `=mode=${mode}` : ""}`;
      const audio = await run(filter, graph);
      const reference = parseWav(readFileSync(new URL(`./fixtures/adynamicequalizer-${fixture}.wav`, import.meta.url)))
        .tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 16000);
      assert.equal(audio.channels, 1);
      assert.equal(audio.channelData[0]!.length, 8192);
      assert.deepEqual(audio.channelData, reference.channelData);
      assert.notDeepEqual(audio.channelData, parseWav(input).tracks[0]!.decodedAudio!.channelData);
    });
  }
}

for (const mode of ["cutbelow", "cutabove", "boostbelow", "boostabove"]) {
  it(`keeps ${mode} history independent between stereo channels`, async () => {
    const mono = parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!;
    const audio = await run(`adynamicequalizer=mode=${mode}`, false,
      encodeWav({ sampleRate: 16000, channels: [Float64Array.from(mono), new Float64Array(mono.length)] }));
    const reference = await run(`adynamicequalizer=mode=${mode}`);
    assert.deepEqual(audio.channelData[0], reference.channelData[0]);
    assert.ok(audio.channelData[1]!.every(sample => sample === 0));
  });
}

for (const filter of ["volume=0,adynamicequalizer=mode=boostabove", "adynamicequalizer=mode=cutabove,volume=0"]) {
  it(`preserves chain order for ${filter}`, async () => {
    const audio = await run(filter);
    assert.ok(audio.channelData[0]!.every(sample => sample === 0));
  });
}

for (const mode of ["cutbelow", "cutabove", "boostbelow", "boostabove"]) {
  it(`bounds ${mode} memory and honors cancellation`, async () => {
    const channels = [new Float32Array(32)];
    const filter = `adynamicequalizer=mode=${mode}`;
    await assert.rejects(listenDynamicEqualizer(channels, 16000, filter,
      new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
    await assert.rejects(listenDynamicEqualizer(channels, 16000, filter,
      new MediaBudgetTracker(), AbortSignal.abort()));
  });
}

for (const option of ["threshold=1", "tftype=lowshelf", "auto=adaptive"]) {
  it(`rejects listen-only ${option} instead of ignoring it in cut mode`, async () => {
    await assert.rejects(listenDynamicEqualizer([new Float32Array(32)], 16000,
      `adynamicequalizer=mode=cutbelow:${option}`, new MediaBudgetTracker()), /unsupported option/);
  });
}

async function run(filter: string, graph = false, bytes: Uint8Array = input) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.wav", bytes);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
}
