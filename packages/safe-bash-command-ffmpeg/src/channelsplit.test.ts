import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [1000, 2000, 3000, 4000];
const right = [-4000, -3000, -2000, -1000];
for (const [filters, expected] of [
  ...["channelsplit[L]", "[0:a]channelsplit[L]", "channelsplit[L][R]"].map(filter => [
    ["-filter_complex", filter, ...(filter.endsWith("[R]") ? ["-map", "[R]"] : []), "/right.wav", "-map", "[L]", "/left.wav"],
    [["/right.wav", right], ["/left.wav", left]]
  ] as const),
  ...["channelsplit@stage=stereo:all", "channelsplit@stage", "anull,channelsplit@stage=channel_layout=stereo:channels=all"].map(filter => [
    ["-filter_complex", `[0:a]${filter}[A][B]`, "-map", "[A]", "/first.wav", "-map", "[B]", "/second.wav"],
    [["/first.wav", left], ["/second.wav", right]]
  ] as const),
  ...([
    ["FL+FR", left, right],
    ["FR+FL", right, left],
    ["FL+FL", left, left],
    ["FR+FR", right, right]
  ] as const).map(([channels, first, second]) => [
    ["-filter_complex", `[0:a]channelsplit=stereo:${channels}[A][B]`, "-map", "[A]", "/first.wav", "-map", "[B]", "/second.wav"],
    [["/first.wav", first], ["/second.wav", second]]
  ] as const),
  [["-filter_complex", "[0:a]channelsplit=channel_layout=stereo[L][R]", "-map", "[L]", "/left.wav", "-map", "[R]", "/out.wav"], [["/left.wav", left], ["/out.wav", right]]],
  [["-af", "channelsplit=channel_layout=stereo:channels=FR", "/out.wav"], [["/out.wav", right]]],
  [["-filter_complex", "channelsplit=stereo:FR", "/out.wav"], [["/out.wav", right]]],
  [["-filter_complex", "[0:a]channelsplit[L][R];[R]areverse[out]", "-map", "[out]", "/out.wav", "-map", "[L]", "/left.wav"], [["/out.wav", [...right].reverse()], ["/left.wav", left]]],
  [["-filter_complex", "[0:a]volume=0.5,channelsplit[L][R]", "-map", "[R]", "/out.wav", "-map", "[L]", "/left.wav"], [["/out.wav", right.map(sample => sample / 2)], ["/left.wav", left.map(sample => sample / 2)]]],
  [["-af", "channelsplit=stereo:FL,areverse", "/out.wav"], [["/out.wav", [...left].reverse()]]]
] as const) {
  it(`splits PCM channels: ${filters.join(" ")}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/twins.wav", encodeWav({ sampleRate: 8000,
      channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/twins.wav", ...filters],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    for (const [path, samples] of expected) {
      const audio = parseWav(volume.readFileSync(path) as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 1);
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData[0]!.length, 4);
      assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), samples);
    }
  });
}

for (const filters of [
  ["-filter_complex", "channelsplit[L]", "-map", "[L]"],
  ["-filter_complex", "channelsplit"],
  ["-filter_complex", "[0:a]channelsplit[L][R]", "-map", "[L]", "-map", "[R]"],
  ["-map", "0:a", "-map", "0:a"]
]) {
  it(`rejects multiple audio streams in WAV: ${filters.join(" ")}`, async () => {
    const input = encodeWav({ sampleRate: 8000,
      channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) });
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", ...filters, "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 234, stderr);
    assert.ok(stderr.includes("WAVE files have exactly one stream"), stderr);
    assert.equal(volume.readFileSync("/out.wav").length, 0);
    assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
  });
}
