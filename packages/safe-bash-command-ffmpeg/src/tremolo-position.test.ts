import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";
import { tremoloAudio } from "./audio-tremolo.js";

// Native FFmpeg 7.0.2: all four split frames retain the WAV packet offset, 44.
for (const [enable, expected] of [
  ["eq(pos\\,44)", "803e5935401f270900002709401f5935803e5935401f270900002709401f5935"],
  ["eq(pos\\,52)", "803e".repeat(16)],
  ["w", "803e".repeat(16)],
  ["h", "803e".repeat(16)],
  ["w+1", "803e5935401f270900002709401f5935803e5935401f270900002709401f5935"],
  ["1", "803e5935401f270900002709401f5935803e5935401f270900002709401f5935"],
  ["0", "803e".repeat(16)],
  ["gte(n\\,2)", "803e803e803e803e803e803e803e803e803e5935401f270900002709401f5935"]
]) {
  for (const graph of [false, true]) it(`tremolo enable=${enable} matches native PCM (graph ${graph})`, async () => {
    const volume = Volume.fromJSON({ "/out": "KEEP" });
    volume.writeFileSync("/in.wav", encodeWav({
      sampleRate: 8000, channels: [new Float64Array(16).fill(16000 / 32768)]
    }));
    const filter = `asetnsamples=n=4:p=0,tremolo=f=1000:d=1:enable=${enable}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
        : ["-af", filter]), "-f", "s16le", "/out"],
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
    assert.equal((volume.readFileSync("/out") as Buffer).toString("hex"), expected);
  });
}

for (const pos of [undefined, -1, 52]) {
  it(`tremolo uses each frame's position, including unavailable position ${pos}`, async () => {
    const output = await tremoloAudio([new Float64Array(8).fill(1)], 8000,
      "tremolo=f=1000:d=1:enable=isnan(pos)+eq(pos,52)",
      [{ start: 0, end: 4, pts: 0, pos: 44 }, { start: 4, end: 8, pts: 4, pos }],
      new MediaBudgetTracker());
    assert.deepEqual(Array.from(output[0]!.slice(0, 5)), [1, 1, 1, 1, 1]);
    assert.ok(output[0]![5]! < 1);
    assert.ok(Math.abs(output[0]![6]! - 0.5) < 1e-15);
  });
}
