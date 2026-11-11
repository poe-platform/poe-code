import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 7.0.2 PCM16 output for three branches of one mono WAV.
for (const [first, second, split, options, runs] of [
  [333, 713, true, ":dropout_transition=0.04", [[1150, 12000]]],
  [333, 713, true, "", [[333, 12000], [380, 8064], [437, 4069]]],
  [333, 713, true, ":dropout_transition=0", [[1150, 12000]]],
  [333, 713, true, ":normalize=0", [[333, 32767], [380, 24000], [437, 12000]]],
  [333, 713, true, ":duration=first", [[333, 12000]]],
  [333, 713, true, ":duration=shortest", [[333, 12000]]],
  [333, 400, true, "", [[333, 12000], [67, 8011], [624, 4058], [126, 4069]]],
  [512, 713, true, "", [[512, 12000], [201, 8034], [437, 4054]]],
  [333, 1024, true, "", [[333, 12000], [691, 8117], [126, 4069]]],
  [0, 713, true, "", [[512, 8086], [201, 8121], [437, 4098]]],
  [713, 333, true, "", [[333, 12000], [179, 8030], [201, 8064], [437, 4069]]],
  [333, 333, true, "", [[333, 12000], [691, 4058], [126, 4069]]],
  [333, 713, false, "", [[333, 12000], [179, 8030], [201, 8064], [311, 4058], [126, 4069]]]
] as const) {
  it(`matches native amix through ${split ? "split" : "independent"} endings ${first}/${second}: ${options || "defaults"}`, async () => {
    const volume = new Volume();
    const lengths = split ? [1150] : [first, second, 1150];
    for (const [index, length] of lengths.entries()) {
      volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(length).fill(12000 / 32768)] }));
    }
    const inputs = split
      ? `[0:a]asplit=3[a][b][z];[a]atrim=end_sample=${first}[x];[b]atrim=end_sample=${second}[y];[x][y][z]`
      : "[0:a][1:a][2:a]";
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", ...lengths.flatMap((_, index) => ["-i", `/${index}.wav`]), "-filter_complex",
        `${inputs}amix=inputs=3${options}[o]`, "-map", "[o]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const expected = Buffer.alloc(runs.reduce((length, [count]) => length + count * 2, 0));
    let offset = 0;
    for (const [count, value] of runs) {
      for (let sample = 0; sample < count; sample++, offset += 2) expected.writeInt16LE(value, offset);
    }
    assert.deepEqual(Buffer.concat(output), expected);
  });
}
