import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { gateAudio } from "./audio-sidechaingate.js";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 12 }, (_, i) => (i + 1) * 1000);
const gated = [61, 122, 184, 245, 401, 791, 1410, 2334, 3647, 5441, 7700, 9994];

async function runGate(enable: string, splitControl = false) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from(samples, x => x / 32768)] }));
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav",
      "-filter_complex", `${splitControl ? "[0:a]asetnsamples=n=4:p=0[key];[0:a][key]" : "[0:a][0:a]"}sidechaingate=enable=${enable}[o]`,
      "-map", "[o]", "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(),
    stdout: { async write(b: Uint8Array) { output.push(b); } },
    stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  assert.equal(Buffer.concat(errors).toString(), "");
  const bytes = Buffer.concat(output);
  return Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2));
}

// Complete PCM16 output from native FFmpeg 7.0.2 for a WAV with a 44-byte header.
for (const [enable, expected] of [
  ["eq(pos\\,44)", gated], ["eq(pos\\,0)", samples], ["1", gated], ["0", samples]
] as const) {
  it(`sidechaingate enable=${enable} matches native PCM samples`, async () => {
    assert.deepEqual(await runGate(enable), expected);
  });
}

it("sidechaingate exposes NaN when the program packet has no source offset", async () => {
  const track = parseWav(encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from(samples, x => x / 32768)] })).tracks[0]!;
  const first = { ...track, samples: track.samples.map(packet => {
    const copy = { ...packet };
    delete copy.offset;
    return copy;
  }) };
  const control = first.decodedAudio!.channelData;
  const enabled = await gateAudio(first, "sidechaingate=enable=isnan(pos)", new MediaBudgetTracker(), control, []);
  const bypassed = await gateAudio(first, "sidechaingate=enable=pos", new MediaBudgetTracker(), control, []);
  const always = await gateAudio(first, "sidechaingate=enable=1", new MediaBudgetTracker(), control, []);
  assert.deepEqual(enabled.decodedAudio!.channelData, always.decodedAudio!.channelData);
  assert.deepEqual(bypassed.decodedAudio!.channelData.map(channel => Array.from(channel)),
    control.map(channel => Array.from(channel)));
  const empty = await gateAudio(first, "sidechaingate=enable=eq(pos,44)", new MediaBudgetTracker(), [new Float64Array(0)], []);
  assert.equal(empty.decodedAudio!.channelData[0]!.length, 0);
});

it("sidechaingate retains the program packet position across shorter control frames", async () => {
  assert.deepEqual(await runGate("eq(pos\\,44)", true), gated);
});
