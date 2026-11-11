import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";
import references from "./audio-compand-delay.snapshot.json" with { type: "json" };

// Native FFmpeg 7.0.2 PCM32 references for an eight-frame clip. Delays longer
// than the clip drain the unused (silent) part of the ring before its samples.
for (const [delay, expected] of [
  [7, [15, -127, 500, -3000, 28000, -19003, 3001, 100]],
  [8, [15, -127, 500, -3000, 28000, -19003, 3001, 100]],
  [9, [0, 15, -127, 500, -3000, 28000, -19003, 3001]],
  [12, [0, 0, 0, 0, 15, -127, 500, -3000]],
  [15, [0, 0, 0, 0, 0, 0, 0, 15]],
  [16, [0, 0, 0, 0, 0, 0, 0, 0]],
  [17, [0, 0, 0, 0, 0, 0, 0, 0]],
  [160000, [0, 0, 0, 0, 0, 0, 0, 0]]
] as const) {
  for (const channelCount of [1, 2]) for (const graph of [false, true]) {
    it(`compand drains ${delay} delayed samples for eight frames (${channelCount} channels, ${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: Array.from({ length: channelCount }, (_, c) =>
        Float64Array.from([15, -127, 500, -3000, 28000, -19003, 3001, 100], sample => sample * (c ? -1 : 1) / 32768)) }));
      const filter = `compand=points=-70/-70|0/0:delay=${delay / 8000}`;
      const errors: Uint8Array[] = [];
      const output: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s32le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write(b: Uint8Array) { output.push(b); } }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal(Buffer.concat(errors).length, 0);
      const actual = Buffer.concat(output);
      const reference = Buffer.alloc(8 * channelCount * 4);
      expected.forEach((sample, i) => {
        for (let c = 0; c < channelCount; c++) reference.writeInt32LE(sample * (c ? -1 : 1) * 65536, (i * channelCount + c) * 4);
      });
      assert.deepEqual(actual, reference);
    });
  }
}

// Full native FFmpeg 9.0.1 PCM16 references for the 1603-frame stereo regression.
// Generate with: ffmpeg -i stereo.wav -af FILTER -f s16le -
for (const [filter, reference] of [...Object.entries(references),
  ["compand=delay=0.00001", references["compand=delay=0"]] as const]) {
  for (const graph of [false, true]) it(`${filter} preserves every stereo frame (${graph ? "graph" : "simple"})`, async () => {
    const amplitudes = [[200, 8000], [1000, 100], [21000, 25000], [8000, 400], [100, 200], [25000, 1000], [400, 21000]];
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [0, 1].map(c =>
      Float64Array.from({ length: 1603 }, (_, i) => (i % 6 < 3 ? 1 : -1) * amplitudes[Math.floor(i / 117) % 7]![c]! / 32768)) }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const actual = fs.readFileSync("/out.pcm") as Buffer;
    const expected = Buffer.from(reference, "base64");
    assert.equal(actual.length, 1603 * 2 * 2);
    assert.equal(actual.length, expected.length);
    for (let offset = 0; offset < actual.length; offset += 2) {
      assert.ok(Math.abs(actual.readInt16LE(offset) - expected.readInt16LE(offset)) <= 1,
        `frame ${Math.floor(offset / 4)}, channel ${offset / 2 % 2}: ${actual.readInt16LE(offset)}, expected ${expected.readInt16LE(offset)}`);
    }
  });
}
