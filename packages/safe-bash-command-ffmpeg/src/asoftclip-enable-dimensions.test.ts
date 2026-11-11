import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete s32le output from native FFmpeg 7.0.2 for this eight-sample WAV.
const clipped = "805f3ea700411dbd80251dd3a05a50f460a5af0b80dae22c00bfe24280a0c158";
const bypassed = "0000a0920000c8b5000020d1000048f40000b80b0000e02e0000384a0000606d";

for (const [enable, expected] of [
  ["eq(w+h\\,0)", clipped], ["w", bypassed], ["h", bypassed],
  ["1", clipped], ["0", bypassed]
] as const) for (const graph of [false, true]) {
  it(`asoftclip enable=${enable} matches native audio dimensions (${graph ? "graph" : "simple"})`, async () => {
    assert.equal(await run(`asoftclip=enable=${enable}`, graph), expected);
  });
}

for (const dimension of ["w", "h"]) for (const graph of [false, true]) {
  it(`asoftclip accepts ${dimension} in a timed enable update (${graph ? "graph" : "simple"})`, async () => {
    assert.equal(await run(`asetnsamples=n=2:p=0,asendcmd=c='0.0005 asoftclip@x enable ${dimension}',asoftclip@x`, graph),
      clipped.slice(0, 32) + bypassed.slice(32));
  });
}

async function run(filter: string, graph: boolean): Promise<string> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from([-28000, -19000, -12000, -3000, 3000, 12000, 19000, 28000], sample => sample / 32768)
  ] }));
  let stderr = "";
  const output: Buffer[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-f", "s32le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  return Buffer.concat(output).toString("hex");
}
