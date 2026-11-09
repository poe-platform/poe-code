import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function mix(filter: string, length = 2048, sampleRate = 8000) {
  const volume = Volume.fromJSON({});
  for (const [path, level] of [["/a.wav", 8000], ["/b.wav", -4000]] as const) {
    volume.writeFileSync(path, encodeWav({ sampleRate,
      channels: [new Float64Array(length).fill(level / 32768)] }));
  }
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
      `[0:a][1:a]${filter}[o]`, "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  const stderr = Buffer.concat(errors).toString();
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, sampleRate);
  assert.equal(audio.channels, 1);
  return { samples: Array.from(audio.channelData[0]!, value => value * 32768), stderr };
}

// Native FFmpeg 7.0.2: mono PCM16 WAV input, with a partial final frame.
for (const [sampleRate, length, frames] of [
  [8000, 2048, [[0, 512], [512, 512], [1024, 512], [1536, 512]]],
  [8000, 1300, [[0, 512], [512, 512], [1024, 276]]],
  [16000, 2300, [[0, 1024], [1024, 1024], [2048, 252]]]
] as const) {
  it(`amix forwards native frame lengths and timestamps at ${sampleRate} Hz (${length} samples)`, async () => {
    const { samples, stderr } = await mix("amix,ashowinfo", length, sampleRate);
    const reported = stderr.split("\n").filter(line => line.includes("nb_samples:"));
    assert.equal(reported.length, frames.length);
    for (const [index, [pts, count]] of frames.entries()) {
      assert.ok(reported[index]!.includes(`n:${index} pts:${pts} pts_time:${pts / sampleRate} `), reported[index]);
      assert.ok(reported[index]!.includes(`nb_samples:${count} `), reported[index]);
    }
    assert.deepEqual(samples, Array(length).fill(2000));
  });
}

for (const [filter, runs] of [
  ["amix,volume=n:eval=frame", [[512, 0], [512, 2000], [512, 4000], [512, 6000]]],
  ["amix,volume=t:eval=frame", [[512, 0], [512, 128], [512, 256], [512, 384]]],
  ["amix,aselect='eq(n,1)'", [[512, 2000]]],
  ["amix,volume=0.5", [[2048, 1000]]],
  ["amix", [[2048, 2000]]]
] as const) {
  it(`matches native downstream PCM for ${filter}`, async () => {
    const { samples } = await mix(filter);
    assert.deepEqual(samples, runs.flatMap(([count, value]) => Array(count).fill(value)));
  });
}
