import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const time of [0.01, 0.064]) for (const target of ["compensationdelay@x", "compensationdelay@y", "compensationdelay"]) {
    it(`scheduled dry gain preserves wet history and targets ${target} at ${time} (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(
        `asendcmd=c='${time} ${target} dry 0.5;0.128 ${target} dry 0.25;0.192 ${target} dry 2',compensationdelay@x=m=1`, graph);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      const left = audio.channelData[0]!;
      const right = audio.channelData[1]!;
      const matches = target !== "compensationdelay@y";
      for (let i = 0; i < 2048; i++) {
        const dry = !matches || i < 512 ? 0 : i < 1024 ? 0.5 : 0.25;
        assert.equal(Math.round(left[i]! * 32768), (i % 512 === 0 ? 12000 * dry : 0) + (i % 512 === 23 ? 12000 : 0), `left ${i}`);
        assert.equal(Math.round(right[i]! * 32768), (i % 512 === 2 ? -8000 * dry : 0) + (i % 512 === 25 ? -8000 : 0), `right ${i}`);
      }
    });
  }
  it(`static dry gain starts at frame zero (${graph ? "graph" : "simple"})`, async () => {
    const { volume, result, stderr } = await run("compensationdelay@x=m=1:dry=0.5", graph);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.channelData[0]![0]! * 32768, 6000);
    assert.equal(audio.channelData[0]![23]! * 32768, 12000);
  });
}

async function run(filter: string, graph = false) {
  const channels = [
    Float64Array.from({ length: 2048 }, (_, i) => (i % 512 == 0 ? 12000 : 0) / 32768),
    Float64Array.from({ length: 2048 }, (_, i) => (i % 512 == 2 ? -8000 : 0) / 32768)
  ];
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 3 } }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
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
