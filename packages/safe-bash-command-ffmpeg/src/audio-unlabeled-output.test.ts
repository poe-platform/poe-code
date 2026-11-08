import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function select(args: string[]) {
  const volume = new Volume();
  const a = [12, 22, 34, 44];
  const b = [-50, -60, -70, -80];
  for (const [path, samples] of [["/a.wav", a], ["/b.wav", b]] as const) {
    const channel = Float64Array.from(samples, sample => sample / 32768);
    volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
      channels: [channel] }));
  }
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/a.wav", "-i", "/b.wav", ...args],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, volume, error: Buffer.concat(errors).toString() };
}

for (const [graph, expected] of [
  ["[1:a]anull", [-50, -60, -70, -80]],
  ["[1:a]volume=0.5", [-25, -30, -35, -40]],
  ["[0:a]volume=0.5", [6, 11, 17, 22]],
  ["[0:a][1:a]astreamselect=map=1", [-50, -60, -70, -80]],
  ["[1:a]anull[mid];[mid]volume=0.5", [-25, -30, -35, -40]]
] as const) {
  it(`routes ${graph} only to the first destination`, async () => {
    const { result, volume, error } = await select(["-filter_complex", graph, "/one.wav", "/two.wav"]);
    assert.equal(result.exitCode, 0, error);
    for (const [path, samples] of [["/one.wav", expected], ["/two.wav", [12, 22, 34, 44]]] as const) {
      const audio = parseWav(volume.readFileSync(path) as Buffer).tracks[0]!.decodedAudio!;
      assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), samples);
    }
  });
}

for (const reverse of [false, true]) {
  it(`preserves explicit input maps, reverse=${reverse}`, async () => {
    const { result, volume, error } = await select([
      "-map", reverse ? "1:a" : "0:a", "-c", "copy", "/one.wav",
      "-map", reverse ? "0:a" : "1:a", "-c", "copy", "/two.wav"
    ]);
    assert.equal(result.exitCode, 0, error);
    const expected = [[12, 22, 34, 44], [-50, -60, -70, -80]];
    if (reverse) expected.reverse();
    for (const [index, path] of ["/one.wav", "/two.wav"].entries()) {
      const audio = parseWav(volume.readFileSync(path) as Buffer).tracks[0]!.decodedAudio!;
      assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), expected[index]);
    }
  });
}
