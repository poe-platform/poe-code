import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function multiply(filter: string, a: number[], b: number[], stereo = false) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  for (const [path, samples] of [["/a.wav", a], ["/b.wav", b]] as const) {
    const channel = Float64Array.from(samples, sample => sample / 32768);
    volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
      channels: stereo ? [channel, channel.map(sample => -sample)] : [channel] }));
  }
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/a.wav", "-i", "/b.wav", ...(
      filter.startsWith("map:") ? ["-map", filter.slice(4)] :
        ["-filter_complex", `[0:a][1:a]${filter}[mix]`, "-map", "[mix]"]),
      "-c:a", "pcm_s16le", "/out.wav"],
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

const a = Array.from({ length: 8192 }, (_, i) => i % 8 < 4 ? 8192 : -8192);
const b = Array.from({ length: 4096 }, (_, i) => i < 2048 ? -16384 : 1024);
for (const filter of ["amultiply", "amultiply@mul"]) {
  for (const stereo of [false, true]) {
    for (const reverse of [false, true]) {
      it(`${filter} matches native PCM and shortest duration, stereo=${stereo}, reverse=${reverse}`, async () => {
        const { result, volume, error } = await multiply(filter, reverse ? b : a, reverse ? a : b, stereo);
        assert.equal(result.exitCode, 0, error);
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.sampleRate, 8000);
        assert.equal(audio.channels, stereo ? 2 : 1);
        for (const channel of audio.channelData) {
          assert.deepEqual(Array.from(channel, sample => sample * 32768), b.map((v, i) => v * a[i]! / 32768));
        }
      });
    }
  }

  it(`${filter} applies following filters`, async () => {
    const { result, volume, error } = await multiply(`${filter},volume=0.5`, a, b);
    assert.equal(result.exitCode, 0, error);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), b.map((v, i) => v * a[i]! / 65536));
  });

  it(`${filter} rejects options without replacing output`, async () => {
    const { result, volume } = await multiply(`${filter}=unknown=1`, a, b);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}
