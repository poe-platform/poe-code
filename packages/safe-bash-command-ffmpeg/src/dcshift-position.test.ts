import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: mono PCM32 WAV at 8 kHz; the data starts at byte 44.
// dcshift=0.25 adds 536870912 to each enabled sample.
for (const [length, prefix, enable, shiftedStart, shiftedEnd] of [
  [8, "", "eq(pos,44)", 0, 8],
  [8, "", "eq(pos,45)", 0, 0],
  [8, "", "pos", 0, 8],
  [8, "", "1", 0, 8],
  [8, "", "0", 0, 0],
  [520, "", "eq(pos,2092)", 512, 520],
  [8, "asetnsamples=n=2:p=0,", "eq(pos,44)", 0, 8],
  [8, "apad=pad_len=8,", "isnan(pos)", 8, 16],
  [8, "asetnsamples=n=2:p=0,asendcmd=c='0.0005 dcshift enable pos',", "0", 4, 8]
] as const) for (const graph of [false, true]) {
  it(`dcshift uses packet positions for ${prefix}${enable}, ${length} samples (${graph ? "graph" : "simple"})`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(length)] }, { bitsPerSample: 32 });
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
    const filter = `${prefix}dcshift=0.25:enable='${enable}'`;
    const output: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s32le", "pipe:1"],
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
    const expected = Buffer.alloc(Math.max(length, shiftedEnd) * 4);
    for (let i = shiftedStart; i < shiftedEnd; i++) expected.writeInt32LE(536870912, i * 4);
    assert.deepEqual(Buffer.concat(output), expected);
  });
}
