import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const impulse = Float64Array.from({ length: 64 }, (_, i) => i === 8 ? 12000 / 32768 : 0);
const input = encodeWav({ sampleRate: 8000, channels: [impulse, impulse] });
// Native FFmpeg PCM16 reference samples, frames 8–10.
for (const [options, expected] of [
  ["", [6828, -7218, -2253]],
  [":w=2", [8703, -6947, -5734]],
  [":width_type=q:width=2", [8703, -6947, -5734]],
  [":width_type=h:width=200", [9566, -6497, -7318]],
  [":t=k:w=0.2", [9566, -6497, -7318]],
  [":t=o:w=1", [8008, -7161, -4425]],
  [":t=s:w=1", [6828, -7218, -2253]],
  [":t=1:w=200", [9566, -6497, -7318]],
  [":p=1:w=2", [8735, -4752, -2166]],
  [":m=0", [12000, 0, 0]],
  ...["q", "h", "k", "o", "s"].map(unit => [`:t=${unit}:w=0`, [12000, 0, 0]] as const)
] as const) {
  for (const graph of [false, true]) it(`matches native highpass width ${options} (graph=${graph})`, async () => {
    const { fs, result, stderr } = await run(`highpass=f=1000${options}`, graph, input);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.channelData.length, 2);
    for (const channel of audio.channelData) {
      const actual = Array.from(channel.slice(7, 11), value => value * 32768);
      for (const [i, value] of [0, ...expected].entries()) {
        assert.ok(Math.abs(actual[i]! - value) <= 1, `${actual[i]} != ${value}`);
      }
    }
  });
}
for (const options of ["w=-1", "width=100000", "w=NaN", "w=", "t=invalid", "width_type=0", "t=6"]) {
  it(`rejects invalid width ${options} without overwriting`, async () => {
    const { fs, result, stderr } = await run(`highpass=${options}`, false, input);
    assert.equal(result.exitCode, 1);
    assert.match(stderr, /highpass/);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
  });
}

async function run(filter: string, graph: boolean, bytes: Uint8Array) {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/in.wav", bytes);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { fs, result, stderr };
}
