import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { parseFfmetadata, probeWavSource, probeWavStream, wavAst } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, createFfprobeCommand } from "./index.js";

function cueWav(repeatedId: boolean, separateChunks: boolean): Buffer {
  const chunk = (name: string, body: Buffer) => {
    const header = Buffer.alloc(8);
    header.write(name); header.writeUInt32LE(body.length, 4);
    return Buffer.concat([header, body, Buffer.alloc(body.length % 2)]);
  };
  const entries = [0, 400].map((start, index) => {
    const entry = Buffer.alloc(24);
    entry.writeUInt32LE(repeatedId ? 1 : index + 1);
    entry.writeUInt32LE(start, 4); entry.write("data", 8);
    entry.writeUInt32LE(start, 20);
    return entry;
  });
  const cues = (separateChunks ? entries.map(entry => [entry]) : [entries]).map(entries => {
    const count = Buffer.alloc(4); count.writeUInt32LE(entries.length);
    return chunk("cue ", Buffer.concat([count, ...entries]));
  });
  const labels = ["Intro", "Demo"].map((title, index) => {
    const id = Buffer.alloc(4); id.writeUInt32LE(index + 1);
    return chunk("labl", Buffer.concat([id, Buffer.from(`${title}\0`)]));
  });
  const audio = encodeWav({ sampleRate: 8000, channels: [new Float64Array(800)] });
  const bytes = Buffer.concat([
    audio.subarray(0, 36), ...cues,
    chunk("LIST", Buffer.concat([Buffer.from("adtl"), ...labels])), audio.subarray(36)
  ]);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  return bytes;
}

for (const repeatedId of [false, true]) for (const separateChunks of [false, true]) {
  const intervals = repeatedId ? [[1, 400, 800, "Intro"]] as const
    : [[1, 0, 400, "Intro"], [2, 400, 800, "Demo"]] as const;
  const chapters = intervals.map(([id, start, end, title]) => ({
    id, time_base: "1/8000", start, start_time: (start / 8000).toFixed(6),
    end, end_time: (end / 8000).toFixed(6), tags: { title }
  }));
  it(`keeps the latest offset per cue ID across WAV readers (repeat=${repeatedId}, separate chunks=${separateChunks})`, async () => {
    const bytes = cueWav(repeatedId, separateChunks);
    assert.deepEqual(wavAst().probe(bytes).chapters, chapters);
    assert.deepEqual((await probeWavSource({ size: bytes.length, async read(offset, length) {
      return bytes.subarray(offset, offset + length);
    } })).chapters, chapters);
    assert.deepEqual((await probeWavStream((async function* () {
      for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
    })(), { seekable: true })).chapters, chapters);
  });
  for (const probe of [false, true]) {
    it(`exports one chapter per WAV cue ID with ${probe ? "ffprobe" : "ffmpeg"} (repeat=${repeatedId}, separate chunks=${separateChunks})`, async () => {
      const bytes = cueWav(repeatedId, separateChunks), volume = Volume.fromJSON({ "/in.wav": bytes });
      let stdout = "", stderr = "";
      const result = await (probe ? createFfprobeCommand() : createFfmpegCommand()).execute({
        args: probe ? ["-v", "error", "-show_chapters", "-of", "json", "/in.wav"]
          : ["-y", "-v", "error", "-i", "/in.wav", "-fflags", "+bitexact", "-f", "ffmetadata", "/out.meta"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(data: Uint8Array) { stdout += new TextDecoder().decode(data); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      if (probe) assert.deepEqual(JSON.parse(stdout).chapters, chapters);
      else assert.deepEqual(parseFfmetadata(volume.readFileSync("/out.meta") as Buffer).chapters?.map(chapter =>
        [chapter.startTimeSeconds, chapter.endTimeSeconds, chapter.title]),
      intervals.map(([, start, end, title]) => [start / 8000, end / 8000, title]));
    });
  }
}
