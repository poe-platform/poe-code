import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { parseFfmetadata, parseWav } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sampleRate of [8000, 44100]) for (const sync of [false, true]) {
  it(`preserves sub-millisecond WAV cues at ${sampleRate} Hz (${sync ? "sync" : "async"})`, async () => {
    const cues = Buffer.alloc(12 + 3 * 24);
    cues.write("cue ");
    cues.writeUInt32LE(cues.length - 8, 4);
    cues.writeUInt32LE(3, 8);
    [1, 3, 7].forEach((start, index) => {
      const offset = 12 + index * 24;
      cues.writeUInt32LE(index + 1, offset);
      cues.writeUInt32LE(start, offset + 4);
      cues.write("data", offset + 8);
      cues.writeUInt32LE(start, offset + 20);
    });
    const wav = Buffer.concat([
      encodeWav({ sampleRate, channels: [new Float64Array(800)] }), cues
    ]);
    wav.writeUInt32LE(wav.length - 8, 4);
    const volume = Volume.fromJSON({ "/in.wav": wav });
    const args = ["-y", "-v", "error", "-i", "/in.wav", "-fflags", "+bitexact", "-f", "ffmetadata", "/out.meta"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    } else {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    }
    const output = volume.readFileSync("/out.meta") as Buffer;
    const chapters = parseFfmetadata(output).chapters!;
    assert.deepEqual(chapters.map(chapter => chapter.timeBase),
      Array.from({ length: 3 }, () => ({ numerator: 1, denominator: sampleRate })));
    assert.deepEqual(chapters.map(chapter => [chapter.startTimeSeconds, chapter.endTimeSeconds]),
      parseWav(wav).chapters!.map(chapter => [chapter.startTimeSeconds, chapter.endTimeSeconds]));
    for (const [start, end] of [[1, 3], [3, 7], [7, 800]]) {
      assert.ok(output.toString().includes(`TIMEBASE=1/${sampleRate}\nSTART=${start}\nEND=${end}\n`));
    }
  });
}
