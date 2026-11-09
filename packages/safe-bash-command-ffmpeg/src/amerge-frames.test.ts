import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, offsets = [0, 0], reverse = false, length = 2048) {
  const volume = Volume.fromJSON({});
  for (const [index, value] of [8000, -4000].entries()) {
    volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(index === 0 ? 2300 : length).fill(value / 32768)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-itsoffset", String(offsets[0]), "-i", "/0.wav",
      "-itsoffset", String(offsets[1]), "-i", "/1.wav", "-filter_complex",
      `${reverse ? "[1:a][0:a]" : "[0:a][1:a]"}amerge,${filter}[out]`,
      "-map", "[out]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 8000);
  assert.equal(audio.channels, 2);
  assert.equal(audio.channelMask ?? 3, 3);
  return audio.channelData.map(channel => Array.from(channel, value => Math.round(value * 32768)));
}

// Native FFmpeg 7.0.2 emits 512-sample frames for these 8 kHz PCM WAV inputs.
it("amerge preserves frame numbers through volume", async () => {
  const channels = await run("volume=n:eval=frame");
  assert.deepEqual(channels, [8000, -4000].map(value =>
    Array.from({ length: 2048 }, (_, i) => value * Math.floor(i / 512) || 0)));
});

for (const [filter, length] of [["aselect=not(n)", 512], ["aselect=eq(n\\,2)", 277]] as const) {
  it(`amerge preserves complete and partial frames through ${filter}`, async () => {
    assert.deepEqual(await run(filter, [0, 0], false, 1301),
      [8000, -4000].map(value => Array<number>(length).fill(value)));
  });
}

for (const reverse of [false, true]) {
  for (const offsets of [[0, 0], [0.064, 0], [0, 0.064]]) {
    it(`amerge uses its first connected input clock (${offsets}, reversed=${reverse})`, async () => {
      const offset = offsets[reverse ? 1 : 0]!;
      const values = reverse ? [-4000, 8000] : [8000, -4000];
      assert.deepEqual(await run("volume=t:eval=frame", offsets, reverse), values.map(value =>
        Array.from({ length: 2048 }, (_, i) => Math.round(value * (offset + Math.floor(i / 512) * 0.064)) || 0)));
      assert.deepEqual(await run(`aselect=eq(t\\,${offset}),volume=t:eval=frame`, offsets, reverse),
        values.map(value => Array<number>(512).fill(Math.round(value * offset) || 0)));
    });
  }
}

it("amerge retains constant volume samples", async () => {
  assert.deepEqual(await run("volume=0.5"), [4000, -2000].map(value => Array<number>(2048).fill(value)));
});
