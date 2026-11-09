import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { probeWavSource, probeWavStream, wavAst } from "@poe-code/mp4-ast";
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

function wav(labelsFirst: boolean, titles: string[] = ["Intro", "Demo"]): Uint8Array {
  const plain = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000)] });
  const cues = new Uint8Array(52), view = new DataView(cues.buffer);
  view.setUint32(0, 2, true);
  for (const [index, start] of [0, 2000].entries()) {
    const pos = 4 + index * 24;
    view.setUint32(pos, index + 1, true);
    view.setUint32(pos + 4, start, true);
    cues.set(new TextEncoder().encode("data"), pos + 8);
    view.setUint32(pos + 20, start, true);
  }
  const labels = titles.map((title, index) => {
    const payload = new Uint8Array(5 + title.length);
    new DataView(payload.buffer).setUint32(0, index + 1, true);
    payload.set(new TextEncoder().encode(title), 4);
    return chunk("labl", payload);
  });
  const list = chunk("LIST", Uint8Array.of(...new TextEncoder().encode("adtl"), ...labels.flatMap(label => [...label])));
  const cue = chunk("cue ", cues);
  const bytes = Uint8Array.of(...plain.subarray(0, 36), ...(labelsFirst ? list : cue), ...(labelsFirst ? cue : list), ...plain.subarray(36));
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  return bytes;
}

const expected = [
  { id: 1, time_base: "1/8000", start: 0, start_time: "0.000000", end: 2000, end_time: "0.250000", tags: { title: "Intro" } },
  { id: 2, time_base: "1/8000", start: 2000, start_time: "0.250000", end: 8000, end_time: "1.000000", tags: { title: "Demo" } }
];

const pipeExpected = expected.map(chapter => chapter.id === 2
  ? { ...chapter, end: chapter.start, end_time: chapter.start_time } : chapter);

for (const labelsFirst of [false, true]) {
  const chapters = labelsFirst ? expected.map(chapter => ({ ...chapter, tags: {} })) : expected;
  const pipeChapters = labelsFirst ? pipeExpected.map(chapter => ({ ...chapter, tags: {} })) : pipeExpected;
  it(`probes cue chapters with labels ${labelsFirst ? "before" : "after"} cues across all WAV readers`, async () => {
    const bytes = wav(labelsFirst);
    expect(wavAst().probe(bytes).chapters).toEqual(chapters);
    expect((await probeWavSource({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } })).chapters).toEqual(chapters);
    expect((await probeWavStream((async function* () {
      for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
    })())).chapters).toEqual(pipeChapters);
  });
}

for (const target of ["/input.wav", "-"]) {
  it(`reports labeled WAV cue points through ffprobe ${target}`, async () => {
    const bytes = wav(false), args = ["-v", "quiet", "-show_chapters", "-of", "json", target];
    const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
    let output = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(output).chapters).toEqual(target === "-" ? pipeExpected : expected);
    expect(JSON.parse(evalSyncFfprobe(target === "-" ? bytes : undefined, args, () => bytes)!).chapters).toEqual(target === "-" ? pipeExpected : expected);
  });
}

for (const invalid of ["cue count", "label length"]) {
  it(`rejects an invalid WAV ${invalid} across readers`, async () => {
    const bytes = wav(false), view = new DataView(bytes.buffer);
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const id = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
      if (invalid === "cue count" && id === "cue ") view.setUint32(offset + 8, 0xffffffff, true);
      if (invalid === "label length" && id === "LIST") view.setUint32(offset + 16, 0xffffffff, true);
      offset += 8 + view.getUint32(offset + 4, true) + (view.getUint32(offset + 4, true) & 1);
    }
    expect(() => wavAst().probe(bytes)).toThrow();
    await expect(probeWavSource({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } })).rejects.toThrow();
    await expect(probeWavStream((async function* () { yield bytes; })())).rejects.toThrow();
  });
}

for (const titles of [[], ["", "ok"]]) {
  for (const labelsFirst of [false, true]) {
    it(`preserves absent and empty WAV labels ${JSON.stringify(titles)}, labelsFirst=${labelsFirst}`, async () => {
      const bytes = wav(labelsFirst, titles);
      const chapters = expected.map(({ tags: _tags, ...chapter }, index) => ({
        ...chapter, ...(labelsFirst || titles[index] === undefined ? {} : { tags: { title: titles[index] } })
      }));
      const probeChapters = chapters.map(chapter => ({ ...chapter, tags: chapter.tags ?? {} }));
      expect(wavAst().probe(bytes).chapters).toEqual(probeChapters);
      expect((await probeWavSource({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } })).chapters).toEqual(probeChapters);
      expect((await probeWavStream((async function* () {
        for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
      })(), { seekable: true })).chapters).toEqual(probeChapters);
      const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
      let output = "";
      const args = ["-v", "error", "-show_chapters", "-of", "json", "/input.wav"];
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(output).chapters).toEqual(chapters);
      expect(JSON.parse(evalSyncFfprobe(undefined, args, () => bytes)!).chapters).toEqual(chapters);
    });
  }
}
