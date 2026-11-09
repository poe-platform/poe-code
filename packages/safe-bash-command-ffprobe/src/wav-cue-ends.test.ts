import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { probeWavSource, wavAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

function chunk(id: string, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length + payload.length % 2);
  bytes.set(new TextEncoder().encode(id));
  new DataView(bytes.buffer).setUint32(4, payload.length, true);
  bytes.set(payload, 8);
  return bytes;
}

function wav(points: readonly (readonly [number, number])[]): Uint8Array {
  const plain = encodeWav({ sampleRate: 8000, channels: [new Float64Array(800)] });
  const cues = new Uint8Array(4 + points.length * 24), view = new DataView(cues.buffer);
  view.setUint32(0, points.length, true);
  for (const [index, [id, start]] of points.entries()) {
    const pos = 4 + index * 24;
    view.setUint32(pos, id, true);
    view.setUint32(pos + 4, start, true);
    cues.set(new TextEncoder().encode("data"), pos + 8);
    view.setUint32(pos + 20, start, true);
  }
  const labels = ["Intro", "Demo"].map((title, index) => {
    const payload = new Uint8Array(5 + title.length);
    new DataView(payload.buffer).setUint32(0, index + 1, true);
    payload.set(new TextEncoder().encode(title), 4);
    return chunk("labl", payload);
  });
  const list = chunk("LIST", Uint8Array.of(...new TextEncoder().encode("adtl"), ...labels[0]!, ...labels[1]!));
  const cue = chunk("cue ", cues);
  const bytes = Uint8Array.of(...plain, ...cue, ...list);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  return bytes;
}

// Native FFmpeg ends each cue at the next strictly later start or the audio end,
// without changing file order or producing an end before the cue's own start.
for (const [name, intervals] of [
  ["ordered", [[1, 0, 400], [2, 400, 800]]],
  ["reverse", [[2, 400, 800], [1, 0, 400]]],
  ["same start", [[1, 400, 800], [2, 400, 800]]],
  ["past end", [[1, 400, 800], [2, 1200, 1200]]],
  ["duplicate before later cue", [[1, 0, 400], [2, 400, 800], [3, 0, 400]]],
  ["at end", [[1, 800, 800], [2, 0, 800]]],
  ["empty", []]
] as const) {
  it(`resolves ${name} cue ends across seekable readers and ffprobe entry points`, async () => {
    const bytes = wav(intervals.map(([id, start]) => [id, start]));
    const chapters = intervals.map(([id, start, end]) => ({
      id, time_base: "1/8000", start, start_time: (start / 8000).toFixed(6),
      end, end_time: (end / 8000).toFixed(6)
    }));
    expect(wavAst().probe(bytes).chapters).toMatchObject(chapters);
    expect((await probeWavSource({ size: bytes.length, async read(offset, length) {
      return bytes.subarray(offset, offset + length);
    } })).chapters).toMatchObject(chapters);
    const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
    const args = ["-v", "error", "-show_chapters", "-of", "json", "/input.wav"];
    let output = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(output).chapters).toMatchObject(chapters);
    expect(JSON.parse(evalSyncFfprobe(undefined, args, () => bytes)!).chapters).toMatchObject(chapters);
  });
}
