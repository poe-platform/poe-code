import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filters: string[], inputs: number[][][], rates: number[] = []) {
  const volume = Volume.fromJSON({ "/out.wav": "preserve" });
  for (const [index, channels] of inputs.entries()) {
    volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: rates[index] ?? 8000,
      channels: channels.map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", ...inputs.flatMap((_, index) => ["-i", `/${index}.wav`]), ...filters, "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, bytes: volume.readFileSync("/out.wav") as Buffer };
}

for (const [inputs, filter, expected, mask] of [
  [[[12000, -2000]], "join=inputs=1:map=0.1-FL|0.0-FR", [-2000, 12000], 3],
  [[[8000], [-4000], [6000]], "join=inputs=3:map=0.0-FL|1.0-FR", [8000, -4000], 3],
  [[[8000], [-4000], [6000]], "join=inputs=3:channel_layout=3.0:map=0.0-FR|1.0-FC|2.0-FL", [6000, 8000, -4000], 7],
  [[[8000], [-4000], [6000]], "join=3:3.0", [-4000, 6000, 8000], 7]
] as const) {
  it(`joins declared input pads: ${filter}`, async () => {
    const { result, stderr, bytes } = await run([
      "-filter_complex", inputs.map((_, index) => `[${index}:a]`).join("") + filter + "[o]", "-map", "[o]"
    ], inputs.map(channels => channels.map(value => Array<number>(32).fill(value))));
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, expected.length);
    assert.equal(audio.channelMask ?? 3, mask);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
      expected.map(value => Array<number>(32).fill(value)));
  });
}

for (const count of ["0", "-1", "2.6", "NaN", "Infinity", "1", "3"]) {
  it(`rejects invalid or mismatched join input count ${count} without replacing output`, async () => {
    const { result, bytes } = await run([
      "-filter_complex", `[0:a][1:a]join=inputs=${count}:map=0.0-FL|1.0-FR[o]`, "-map", "[o]"
    ], [[[8000]], [[-4000]]]);
    assert.notEqual(result.exitCode, 0);
    assert.equal(bytes.toString(), "preserve");
  });
}

it("stops at the shortest input even when that input is not mapped", async () => {
  const { result, stderr, bytes } = await run([
    "-filter_complex", "[0:a][1:a][2:a]join=inputs=3:map=0.0-FL|1.0-FR[o]", "-map", "[o]"
  ], [[[8000, 8000]], [[-4000, -4000]], [[6000]]]);
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
  assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), [[8000], [-4000]]);
});

it("resamples the third input before joining", async () => {
  const { result, stderr, bytes } = await run([
    "-filter_complex", "[0:a][1:a][2:a]join=inputs=3:map=0.0-FL|1.0-FR[o]", "-map", "[o]"
  ], [[Array<number>(64).fill(8000)], [Array<number>(64).fill(-4000)], [Array<number>(128).fill(6000)]], [8000, 8000, 16000]);
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 8000);
  assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), [Array<number>(64).fill(8000), Array<number>(64).fill(-4000)]);
});
