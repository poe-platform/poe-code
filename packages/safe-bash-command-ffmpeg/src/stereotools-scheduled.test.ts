import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95];
const muted = [1000, -2000, 3000, 1234, 0, 909, 0, -32000, 0, -33, 0, 95];
const swapped = [1000, -2000, 3000, 1234, 909, -527, -32000, 32767, -33, 17, 95, 94];
const gained = [1000, -2000, 3000, 1234, -264, 454, 16384, -16000, 8, -16, 47, 48];

for (const graph of [false, true]) {
  for (const [command, filter, expected] of [
    ["0.00025 stereotools mutel 1", "stereotools", muted],
    ["0.00025 stereotools muter true", "stereotools", [...samples.slice(0, 4), -527, 0, 32767, 0, 17, 0, 94, 0]],
    ["0.00025 stereotools phasel yes", "stereotools", [...samples.slice(0, 4), 527, 909, -32767, -32000, -17, -33, -94, 95]],
    ["0.00025 stereotools phaser on", "stereotools", [...samples.slice(0, 4), -527, -909, 32767, 32000, 17, 33, 94, -95]],
    ["0.00025 stereotools softclip 1", "stereotools", [1000, -2000, 3000, 1234, -671, 1157, 32767, -32273, 22, -42, 120, 121]],
    ["0.00025 stereotools mode lr>rl", "stereotools", swapped],
    ["0.00025 stereotools mode max-4", "stereotools", swapped],
    ["0.00025 stereotools level_in default/2", "stereotools", gained],
    ["0.00025 stereotools mode 6", "stereotools", swapped],
    ["0.00025 stereotools@x level_out 0.5", "stereotools@x", gained],
    ["0.00025 stereotools level_in 1/2", "stereotools", gained],
    ["0.00025 stereotools@x level_out 0.5", "stereotools@other,stereotools@x", gained],
    ["0.00025 stereotools level_out 0.5", "stereotools@first,stereotools@second", gained],
    ["0.00025 stereotools mlev 0.5,stereotools slev 0.5", "stereotools", gained],
    ["0.00025 stereotools@missing mutel 1", "stereotools@x", samples],
    ["0.00026 stereotools mutel 1", "stereotools", [...samples.slice(0, 8), 0, -33, 0, 95]],
    ["0.00025 stereotools mutel 1;0.0005 stereotools mutel 0", "stereotools", [...muted.slice(0, 8), ...samples.slice(8)]],
    ["0.00025 stereotools mutel 1;0.0005 stereotools mutel 2", "stereotools", muted],
    ["0.00025 stereotools mode lr>rl;0.0005 stereotools mode nonsense", "stereotools", swapped],
    ["0.00025 stereotools level_out 0.5;0.0005 stereotools level_out 100", "stereotools", gained],
    ["0.00025 stereotools unknown 1", "stereotools", samples]
  ] as const) {
    it(`scheduled stereotools (${graph ? "graph" : "simple"}): ${command} -> ${filter}`, async () => {
      assert.deepEqual(await run(`asendcmd=c='${command}',${filter}`, graph), expected);
    });
  }

  it(`scheduled stereotools keeps delay history (${graph ? "graph" : "simple"})`, async () => {
    assert.deepEqual(await run("asendcmd=c='0.00025 stereotools level_out 0.5',stereotools=delay=0.5", graph),
      [1000, 0, 3000, 0, -264, -1000, 16384, 617, 8, 454, 47, -16000]);
  });

  it(`downstream sender changes stereotools after its current frame (${graph ? "graph" : "simple"})`, async () => {
    assert.deepEqual(await run("stereotools,asendcmd=c='0.00025 stereotools mutel 1'", graph),
      [...samples.slice(0, 8), 0, -33, 0, 95]);
  });

  it(`keeps static stereotools mute behavior (${graph ? "graph" : "simple"})`, async () => {
    assert.deepEqual(await run("stereotools=mutel=1", graph), samples.map((value, i) => i % 2 ? value : 0));
  });
}

async function run(filter: string, graph: boolean): Promise<number[]> {
  const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000,
    channels: [0, 1].map(channel => Float64Array.from({ length: samples.length / 2 },
      (_, i) => samples[i * 2 + channel]! / 32768))
  })) });
  const chain = `asetnsamples=n=2:p=0,${filter}`;
  const output: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]), "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const pcm = Buffer.concat(output);
  return Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2));
}
