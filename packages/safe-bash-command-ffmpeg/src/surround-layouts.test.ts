import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(1536 * 4);
for (let i = 0; i < 1536; i++) {
  input.writeInt16LE((i % 128 < 64 ? 1 : -1) * 900, i * 4);
  input.writeInt16LE(((i + 13) % 128 < 64 ? 1 : -1) * 600 + (i % 16 < 8 ? 1 : -1) * 200, i * 4 + 2);
}
async function run(layout: string, graph: boolean, format = "s16le", suffix = "") {
  const fs = Volume.fromJSON({ "/in.raw": input });
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const filter = `surround=win_size=1024${layout ? `:chl_out=${layout}` : ""}${suffix}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", format, "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  return Buffer.concat(chunks);
}

// Native FFmpeg 7.0.2: all 1536 frames, with distinct side and back speaker PCM.
for (const [layout, channels, mask, hash] of [
  ["", 6, 0x3f, "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  ["stereo", 2, 3, "de7de99152cc5027430a55bc33a197cb01e3686f994ac3a5f3ba593e5a1c010a"],
  ["quad", 4, 0x33, "9b2ef890132ea59790450b83f3ecff2c067fbbc499a38990a8907dcb18678a81"],
  ["5.1(side)", 6, 0x60f, "54bb44e2689a7d31709a648f6ecab333ce70d1009cf4a2c6be57797b70f2644c"],
  ["7.1", 8, 0x63f, "a5bf27c80041781d532e8935ca407a383d61ed932f12deb50b0cc24748445075"]
] as const) for (const graph of [false, true]) {
  it(`surround ${layout || "default"} matches native PCM and length (graph=${graph})`, async () => {
    const pcm = await run(layout, graph);
    assert.equal(pcm.length, 1536 * channels * 2);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
  if (channels > 2) it(`surround ${layout || "default"} preserves WAV speaker metadata (graph=${graph})`, async () => {
    const audio = parseWav(await run(layout, graph, "wav")).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, channels);
    assert.equal(audio.channelMask, mask);
    assert.equal(audio.channelData[0]!.length, 1536);
  });
}

for (const [layout, speaker, channel] of [["quad", "BL", 2], ["5.1(side)", "SL", 4], ["7.1", "SR", 7]] as const) {
  it(`surround ${layout} retains ${speaker} for downstream pan`, async () => {
    const pcm = await run(layout, false);
    const mono = await run(layout, false, "s16le", `,pan=mono|c0=${speaker}`);
    const channels = pcm.length / (1536 * 2);
    assert.equal(mono.length, 1536 * 2);
    for (let i = 0; i < 1536; i++) assert.equal(mono.readInt16LE(i * 2), pcm.readInt16LE((i * channels + channel) * 2));
  });
}

for (const [layout, alias] of [["quad", "FL+FR+BL+BR"], ["5.1(side)", "0x60f"], ["7.1", "8c"]]) {
  it(`surround ${alias} matches ${layout}`, async () => {
    assert.deepEqual(await run(alias!, false), await run(layout!, false));
  });
}

for (const [layout, speaker, channel] of [["quad", "bl", 2], ["5.1(side)", "sl", 4], ["7.1", "sr", 7]] as const) {
  for (const option of [`${speaker}_out=0`, `${speaker}x=2`, `${speaker}y=2`]) {
    it(`surround ${layout} applies ${option} only to its speaker`, async () => {
      const control = await run(layout, false);
      const actual = await run(layout, false, "s16le", `:${option}`);
      assert.equal(actual.length, control.length);
      const channels = control.length / (1536 * 2);
      let changed = 0;
      for (let i = 0; i < 1536 * channels; i++) {
        if (i % channels === channel) {
          if (option.endsWith("_out=0")) assert.equal(actual.readInt16LE(i * 2), 0);
          if (actual.readInt16LE(i * 2) !== control.readInt16LE(i * 2)) changed++;
        } else assert.equal(actual.readInt16LE(i * 2), control.readInt16LE(i * 2));
      }
      assert.ok(changed > 0);
    });
  }
}
