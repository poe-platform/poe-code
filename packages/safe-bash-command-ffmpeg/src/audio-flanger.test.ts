import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 9.0.1 PCM waveforms, including modulation across input frames.
const cases = [
  [
    "anull",
    256,
    false,
    "3937c7b9c7de63ad7fed4ab7b3898f773c2e30f8e08587139a48c9ce530ee518"
  ],
  [
    "flanger",
    256,
    false,
    "3937c7b9c7de63ad7fed4ab7b3898f773c2e30f8e08587139a48c9ce530ee518"
  ],
  [
    "flanger=delay=2:depth=4:regen=20:width=60:speed=2",
    256,
    false,
    "db603ff4db3d72c353fca39e20849b962750ccbacd9c1dc4f7974054c041ae62"
  ],
  [
    "flanger",
    4096,
    true,
    "b5352f0c273fb0c699e88106201950935e78c082c62c315f0b8598bd631983df"
  ],
  [
    "flanger=2:4:-20:60:2:t:50:quadratic",
    4096,
    true,
    "29a058ba00f8e58a36be35070e72ccf4d11c5fbac3ada59bfdf7f12091fed809"
  ],
  [
    "flanger=delay=0:depth=0",
    4096,
    true,
    "b8e07252e145566b6109db727c5778e407ba3f41ba4deffc82475f0850fb0fa0"
  ],
  [
    "flanger=delay=0.0625:depth=4:regen=95:speed=3:phase=75:interp=quadratic",
    4096,
    true,
    "ca235ec0367d1bea7bed02dbf756d3023a23bf6aacbe214a496cf45c6b167c56"
  ]
] as const;
for (const [filter, frames, stereo, hash] of cases) {
  for (const graph of [false, true]) {
    it(`${filter} matches native PCM (${frames} frames, graph=${graph})`, async () => {
      const { volume, result, stderr } = await run(filter, frames, stereo, graph);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = volume.readFileSync("/out.s16") as Buffer;
      assert.equal(pcm.length, frames * (stereo ? 4 : 2));
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      if (filter === "flanger=delay=2:depth=4:regen=20:width=60:speed=2") {
        // Also matches the reported FFmpeg 7.0.2 impulse response.
        for (const [index, value] of [[0, 10000], [16, 4776], [17, 27], [33, 935]]) {
          assert.equal(pcm.readInt16LE(index! * 2), value);
        }
      }
    });
  }
}

for (const [expression, decimal] of [
  ["PI", "3.141592653589793"],
  ["E", "2.718281828459045"],
  ["PHI", "1.618033988749895"],
  ["PI/2", "1.5707963267948966"],
  ["1+1", "2"]
]) {
  for (const graph of [false, true]) {
    it(`flanger delay=${expression} matches its decimal control (graph=${graph})`, async () => {
      const control = await run(`flanger=delay=${decimal}`, 4096, true, graph);
      assert.equal(control.result.exitCode, 0, control.stderr);
      const actual = await run(`flanger=delay=${expression}`, 4096, true, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal((actual.volume.readFileSync("/out.s16") as Buffer).length, 16384);
      assert.deepEqual(actual.volume.readFileSync("/out.s16"), control.volume.readFileSync("/out.s16"));
    });
  }
}

for (const option of ["delay=-1", "depth=11", "regen=96", "width=101", "speed=0", "phase=101", "shape=bad", "interp=2", "unknown=1", "delay=NaN", "delay=PI*10"]) {
  it(`rejects ${option} without replacing output`, async () => {
    const { volume, result } = await run(`flanger=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.s16", "utf8"), "keep");
  });
}

async function run(filter: string, frames = 256, stereo = false, graph = false) {
  const channels = Array.from({ length: stereo ? 2 : 1 }, (_, c) =>
    Float64Array.from({ length: frames }, (_, i) =>
      (stereo ? (i * 997 + c * 831) % 32000 - 16000 : i === 0 ? 16000 : 0) / 32768));
  const volume = Volume.fromJSON({ "/out.s16": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "-f", "s16le", "/out.s16"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr };
}
