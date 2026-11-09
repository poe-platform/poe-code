import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [1000, 2000, 3000, 4000];
const right = [-8000, -6000, -4000, -2000];

async function run(graph: string, maps: string[], inputs = 1) {
  const volume = new Volume();
  for (let index = 0; index < inputs; index++) {
    volume.writeFileSync(`/in${index}.wav`, encodeWav({ sampleRate: 8000,
      channels: [left, right].map(samples => Float64Array.from(samples, sample => sample * (index + 1) / 32768)) }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...Array.from({ length: inputs }, (_, index) => ["-i", `/in${index}.wav`]).flat(),
      "-filter_complex", graph, ...maps.flatMap((map, index) => ["-map", `[${map}]`, "-c:a", "pcm_s16le", `/out${index}.wav`])],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, volume, stderr };
}

for (const prefix of ["", "[0:a]"]) {
  for (const [filter, expected, mask] of [
    ["channelsplit=channels=FR", [right], 2],
    ["anull", [left, right], undefined],
    ["anull,channelsplit=channels=FR", [right], 2]
  ] as const) {
    it(`binds ${prefix}${filter}[o] and preserves PCM and speaker layout`, async () => {
      const { result, volume, stderr } = await run(`${prefix}${filter}[o]`, ["o"]);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out0.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
      if (mask !== undefined) assert.equal(audio.channelMask, mask);
    });
  }
}

it("shares an implicit input between channelsplit output branches", async () => {
  const { result, volume, stderr } = await run("channelsplit[L][R];[R]areverse[o]", ["o", "L"]);
  assert.equal(result.exitCode, 0, stderr);
  for (const [index, expected] of [[0, [...right].reverse()], [1, left]] as const) {
    const audio = parseWav(volume.readFileSync(`/out${index}.wav`) as Buffer).tracks[0]!.decodedAudio!;
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), expected);
    assert.equal(audio.channelMask, index === 0 ? 2 : 1);
  }
});

for (const graph of ["anull[a];anull[b]", "[0:a]anull[a];anull[b]", "[0:0]anull[a];anull[b]"]) {
  it(`selects unused inputs in graph order for ${graph}`, async () => {
    const { result, volume, stderr } = await run(graph, ["b", "a"], 2);
    assert.equal(result.exitCode, 0, stderr);
    for (const [index, multiplier] of [[0, 2], [1, 1]] as const) {
      const audio = parseWav(volume.readFileSync(`/out${index}.wav`) as Buffer).tracks[0]!.decodedAudio!;
      assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
        [left, right].map(channel => channel.map(sample => sample * multiplier)));
    }
  });
}

it("rejects an implicit input when all audio streams are already connected", async () => {
  const { result, volume, stderr } = await run("[0:a]anull[a];anull[b]", ["b", "a"]);
  assert.notEqual(result.exitCode, 0);
  assert.ok(stderr.includes("unlabeled audio filter input"), stderr);
  assert.equal(volume.readFileSync("/out0.wav").length, 0);
});

it("allows a later explicit label to reuse the implicitly selected stream", async () => {
  const { result, volume, stderr } = await run("anull[a];[0:a]anull[b]", ["b", "a"]);
  assert.equal(result.exitCode, 0, stderr);
  for (const index of [0, 1]) {
    const audio = parseWav(volume.readFileSync(`/out${index}.wav`) as Buffer).tracks[0]!.decodedAudio!;
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), [left, right]);
  }
});
