import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav, parseAudio } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) for (const filter of ["anull", "haas"]) {
  it(`${filter} preserves the double-precision mid signal and taps (${graph ? "graph" : "simple"})`, async () => {
    const channels = [new Float64Array(150), new Float64Array(150)];
    channels[0]![0] = 0.5;
    channels[1]![0] = 2 ** -26;
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 44100, channels }, { float: true, bitsPerSample: 64 }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-c:a", "pcm_f64le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseAudio(fs.readFileSync("/out.wav") as Buffer);
    assert.equal(audio.streams[0]!.bitsPerSample, 64);
    const pcm = Buffer.concat(audio.nodes.filter(node => node.type === "data").map(node => node.data));
    assert.equal(pcm.length, 150 * 2 * 8);
    // Native FFmpeg 7.0.2: the average needs more precision than either input.
    const expected = new Array<number>(300).fill(0);
    if (filter === "haas") {
      expected[0] = expected[1] = expected[181] = 0.2500000074505806;
      expected[186] = -0.2500000074505806;
    } else {
      expected[0] = 0.5;
      expected[1] = 2 ** -26;
    }
    assert.deepEqual(Array.from({ length: 300 }, (_, i) => pcm.readDoubleLE(i * 8)), expected);
  });
}
