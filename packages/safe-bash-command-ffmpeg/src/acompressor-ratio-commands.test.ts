import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 references from native FFmpeg 7.0.2, using the same 24-sample WAV.
const unchanged = [6271, -523, 0, 2616, -4188, 8095, 4859, -405, 0, 2027, -3245, 8095, 4859, -405, 0, 2027, -3245, 8095, 4859, -405, 0, 2027, -3245, 8095];
const changed = [6271, -523, 0, 2616, -4188, 8095, 4859, -405, 0, 1030, -1650, 4108, 2466, -206, 0, 1030, -1650, 4108, 2466, -206, 0, 1030, -1650, 4108];
const betweenFrames = [6271, -523, 0, 2616, -4188, 8095, 4859, -405, 0, 2027, -3245, 8095, 4859, -405, 0, 2027, -1650, 4108, 2466, -206, 0, 1030, -1650, 4108];
const fixed = [3854, -321, 0, 1610, -2577, 4108, 2466, -206, 0, 1030, -1650, 4108, 2466, -206, 0, 1030, -1650, 4108, 2466, -206, 0, 1030, -1650, 4108];
const makeup = [6271, -523, 0, 2616, -4188, 8095, 4859, -405, 0, 4055, -6491, 16191, 9718, -810, 0, 4055, -6491, 16191, 9718, -810, 0, 4055, -6491, 16191];

for (const graph of [false, true]) {
  for (const [command, options, expected] of [
    ["", "", unchanged],
    ["0.001 acompressor@one ratio 8", "", changed],
    ["0.0015 acompressor@one ratio 8", "", betweenFrames],
    ["0.001 acompressor@other ratio 8", "", unchanged],
    ["", ":ratio=8", fixed],
    ["0 acompressor@one ratio 8", "", fixed],
    ["0.001 acompressor@one makeup 2", "", makeup],
    ["0.001 acompressor ratio 4*2", "", changed],
    ["0.003 acompressor@one ratio 8", "", unchanged]
  ] as const) {
    it(`acompressor ratio matches native: ${command || options || "control"} (${graph ? "graph" : "simple"})`, async () => {
      assert.deepEqual(await run(command, options, graph), expected);
    });
  }

  it(`acompressor retains ratio after rejected commands and accepts later updates (${graph ? "graph" : "simple"})`, async () => {
    for (const value of ["0", "21", "NaN", "1/0", "invalid"]) {
      assert.deepEqual(await run(`0 acompressor@one ratio 8;0.001 acompressor@one ratio ${value}`, "", graph), fixed);
      assert.deepEqual(await run(`0 acompressor@one ratio ${value};0.001 acompressor@one ratio 8`, "", graph), changed);
    }
  });
}

async function run(command: string, options: string, graph: boolean): Promise<number[]> {
  const samples = Float64Array.from({ length: 24 }, (_, i) => [12000, -1000, 0, 5000, -8000, 20000][i % 6]! / 32768);
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [samples] })) });
  const chain = `asetnsamples=n=8:p=0,${command ? `asendcmd=c='${command}',` : ""}acompressor@one=threshold=0.1:attack=0.01${options}`;
  const output: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-loglevel", "error", "-i", "/in.wav",
      ...(graph ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
      "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); }, async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  const pcm = Buffer.concat(output);
  return Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2));
}
