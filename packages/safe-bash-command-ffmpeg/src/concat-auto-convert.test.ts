import assert from "node:assert/strict";
import { it } from "node:test";
import { readFile } from "node:fs/promises";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

function units(data: Uint8Array): Uint8Array[] {
  const result: Uint8Array[] = [];
  for (let offset = 0; offset < data.length;) {
    const size = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0);
    offset += 4;
    result.push(data.subarray(offset, offset + size));
    offset += size;
  }
  return result;
}

for (const autoConvert of [undefined, "0", "1", "reset", "detect"]) {
  it(`concat H.264 auto_convert=${autoConvert} preserves slices and timestamps`, async () => {
    const inputs = await Promise.all(["a", "b"].map(name =>
      readFile(new URL(`./fixtures/concat-auto-convert/${name}.mp4`, import.meta.url))));
    const volume = Volume.fromJSON({
      "/a.mp4": Buffer.from(inputs[0]!), "/b.mp4": Buffer.from(inputs[1]!),
      "/list.ffconcat": "ffconcat version 1.0\nfile a.mp4\nfile b.mp4\n"
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: [
        ...(autoConvert === "reset" ? ["-f", "concat", "-auto_convert", "0", "-i", "/list.ffconcat"] : []),
        ...(autoConvert === "detect" ? [] : ["-f", "concat"]),
        ...(["0", "1"].includes(autoConvert ?? "") ? ["-auto_convert", autoConvert!] : []),
        "-i", "/list.ffconcat", ...(autoConvert === "reset" ? ["-map", "1:v"] : []),
        "-c", "copy", "/out.mp4"
      ],
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
    const selected = sources.flatMap(source => source.samples);
    const slices = (data: Uint8Array) => units(data).filter(unit => [1, 5].includes(unit[0]! & 31)).map(unit => Buffer.from(unit));
    assert.deepEqual(track.samples.map(sample => slices(sample.data)), selected.map(sample => slices(sample.data)));
    assert.deepEqual(track.samples.map(sample => sample.pts / track.timescale), Array.from({ length: 20 }, (_, i) => i / 5));
    assert.deepEqual(track.samples.map(sample => sample.dts), track.samples.map(sample => sample.pts));
    for (const index of [0, 5, 10, 15]) {
      assert.deepEqual(units(track.samples[index]!.data).map(unit => unit[0]! & 31),
        [...(index % 10 === 0 ? [6] : []), ...(autoConvert === "0" ? [] : [7, 8]), 5]);
    }
  });
}
