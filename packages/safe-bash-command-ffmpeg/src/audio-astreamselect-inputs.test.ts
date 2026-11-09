import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(graph: string, inputs = 2) {
  const volume = new Volume();
  for (const [index, value] of [8000, -4000, 2000].slice(0, inputs).entries()) {
    volume.writeFileSync(`/in${index}.wav`, encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(2048).fill(value / 32768)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...Array.from({ length: inputs }, (_, index) => ["-i", `/in${index}.wav`]).flat(),
      "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_s16le", "/out.wav"],
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

for (const [graph, inputs, expected] of [
  ["[1:a]astreamselect=map=1[out]", 2, 8000],
  ["astreamselect=map=1[out]", 2, -4000],
  ["[1:a][0:a]astreamselect=map=1[out]", 2, 8000],
  ["[1:0]astreamselect@pick=2:1[out]", 2, 8000],
  ["[1:a]volume=0.5[x];[x]astreamselect=map=0[out]", 2, -2000],
  ["[1:a]volume=0.5[x];[x]astreamselect=map=1,volume=0.5[out]", 2, 4000],
  ["astreamselect=inputs=3:map=2[out]", 3, 2000],
  ["[2:a]astreamselect=3:2[out]", 3, -4000],
  ["[2:a]astreamselect=inputs=1+2:map=1[out]", 3, 8000],
  ["[1:a]astreamselect=inputs=3:inputs=2:map=1[out]", 2, 8000],
  ["[1:a]astreamselect=inputs=2.5:map=1[out]", 2, 8000],
  ["[0:a]anullsink;astreamselect=map=0[out]", 3, -4000],
  ["astreamselect=map=1[x];[0:a]anullsink;[x]anull[out]", 2, -4000]
] as const) {
  it(`connects unused audio streams for ${graph}`, async () => {
    const { result, volume, stderr } = await run(graph, inputs);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 1);
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), Array(2048).fill(expected));
  });
}

for (const [graph, inputs] of [
  ["astreamselect=map=1[out]", 1],
  ["[1:a]astreamselect=inputs=3:map=1[out]", 2],
  ["[0:a]anullsink;[1:a]astreamselect=map=1[out]", 2],
  ["[0:a][1:a][2:a]astreamselect=map=1[out]", 3]
] as const) {
  it(`rejects unavailable or excess inputs for ${graph}`, async () => {
    const { result, volume, stderr } = await run(graph, inputs);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("input"), stderr);
    assert.equal(volume.existsSync("/out.wav"), false);
  });
}
