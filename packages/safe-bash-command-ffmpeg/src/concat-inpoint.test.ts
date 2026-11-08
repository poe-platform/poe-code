import assert from "node:assert/strict";
import { it } from "node:test";
import { readFile } from "node:fs/promises";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

function slices(data: Uint8Array): Buffer[] {
  const result: Buffer[] = [];
  for (let offset = 0; offset < data.length;) {
    const size = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0);
    offset += 4;
    if ([1, 5].includes(data[offset]! & 31)) result.push(Buffer.from(data.subarray(offset, offset + size)));
    offset += size;
  }
  return result;
}

for (const inpoint of [undefined, 1.4]) {
  it(`preserves concat preroll packet content and timing with inpoint ${inpoint}`, async () => {
    const inputs = await Promise.all(["a", "b"].map(name =>
      readFile(new URL(`./fixtures/concat-inpoint/${name}.mp4`, import.meta.url))));
    const volume = Volume.fromJSON({
      "/a.mp4": Buffer.from(inputs[0]!), "/b.mp4": Buffer.from(inputs[1]!),
      "/list.ffconcat": `ffconcat version 1.0\nfile a.mp4\nfile b.mp4\n${inpoint === undefined ? "" : `inpoint ${inpoint}\n`}`
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-f", "concat", "-i", "/list.ffconcat", "-c", "copy", "/out.mp4"],
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
    const track = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
    const sources = inputs.map(input => parseMp4(input).tracks[0]!);
    const selected = [...sources[0]!.samples, ...sources[1]!.samples.slice(inpoint === undefined ? 0 : 5)];
    assert.deepEqual(track.samples.map(sample => slices(sample.data)),
      selected.map(sample => slices(sample.data)));
    let previous = -1;
    const expected = selected.map((sample, index) => {
      const seconds = index < 10 ? sample.dts / sources[0]!.timescale
        : 2 + sample.dts / sources[1]!.timescale - (inpoint ?? 0);
      previous = Math.max(previous + 1, Math.round(seconds * track.timescale));
      return previous;
    });
    assert.deepEqual(track.samples.map(sample => sample.dts), expected);
    assert.deepEqual(track.samples.map(sample => sample.pts), expected);
    assert.equal(track.samples.at(-1)!.pts / track.timescale, inpoint === undefined ? 3.8 : 2.4);
    if (inpoint !== undefined) assert.equal(track.samples[12]!.pts / track.timescale, 2);
  });
}
