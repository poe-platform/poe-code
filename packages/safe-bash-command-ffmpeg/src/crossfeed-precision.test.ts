import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav, parseAudio } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 decoded f64le hashes for all 2200 interleaved samples.
// Check numerical output independently of ashowinfo's reported sample format.
for (const [filter, firstSample, digest] of [
  ["anull", 0.457763671875, "1c56f7262a95e3d39b001e4429c590848b9decc732c8c54c4849938e2c9df4f3"],
  ["crossfeed=strength=0:level_in=1:level_out=1", 0.457763671875, "1c56f7262a95e3d39b001e4429c590848b9decc732c8c54c4849938e2c9df4f3"],
  ["crossfeed=strength=0:level_in=1:level_out=0.99999999", 0.4577636672973633, "39b1ad063ec703b228a8de13064ec9d29cff3f978ca4c57f1aed3eba3fea0e7e"],
  ["crossfeed=level_in=0.99999999", 0.4141626574824391, "a467427532c660887645fd88b78cd4397e2928cebe5fb668e5dff6e028a12407"]
] as const) for (const graph of [false, true]) {
  it(`preserves float64 WAV samples for ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const channels = [new Float64Array(1100), new Float64Array(1100)];
    for (const frame of [0, 510, 512, 1022, 1024]) channels[0]![frame] = 15000 / 32768;
    for (const frame of [3, 515, 1027]) channels[1]![frame] = -8000 / 32768;
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
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
    assert.equal(audio.streams[0]!.codec, "pcm_float");
    assert.equal(audio.streams[0]!.bitsPerSample, 64);
    assert.equal(audio.streams[0]!.sampleRate, 8000);
    assert.equal(audio.streams[0]!.channels, 2);
    const pcm = Buffer.concat(audio.nodes.filter(node => node.type === "data").map(node => node.data));
    assert.equal(pcm.length, 2200 * 8);
    assert.equal(pcm.readDoubleLE(), firstSample);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), digest);
  });
}
