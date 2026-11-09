import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [1000, 2000, 3000, 4000];
const right = [-8000, -6000, -4000, -2000];
for (const [graph, samples, mask] of [
  ["[0:a]channelsplit[l][r];[l]anullsink;[r]anull[o]", [right], 2],
  ["[0:a]channelsplit[l][r];[r]anullsink;[l]anull[o]", [left], 1],
  ["[l]anullsink;[r]anull[o];[0:a]channelsplit[l][r]", [right], 2],
  ["[0:a]asplit[l][r];[l]anullsink;[r]anull[o]", [left, right], 3],
  ["[0:a]anullsink;[1:a]anull[o]", [right, left], 3],
  ["[0:a]anullsink@discard;[1:a]anull[o]", [right, left], 3],
  ["[0:a]channelsplit[l][r];[l]volume=0.5,anullsink;[r]anull[o]", [right], 2],
  ["[0:a]anullsink;[1:a]areverse[o]", [[...right].reverse(), [...left].reverse()], 3]
] as const) {
  it(`consumes audio without producing a stream: ${graph}`, async () => {
    const volume = Volume.fromJSON({});
    for (const [path, channels] of [["/a.wav", [left, right]], ["/b.wav", [right, left]]] as const) {
      volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
        channels: channels.map(values => Float64Array.from(values, value => value / 32768)) }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/a.wav", "-i", "/b.wav",
        "-filter_complex", graph, "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
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
    const tracks = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks;
    assert.equal(tracks.length, 1);
    const audio = tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, samples.length);
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelMask ?? 3, mask);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), samples);
  });
}

for (const [graph, map] of [
  ["[0:a]channelsplit[l][r];[r]anull[o]", "o"],
  ["[0:a]channelsplit[l][r];[l]anullsink;[r]anull[o]", "l"],
  ["[0:a]channelsplit[l][r];[l]anullsink[sink];[r]anull[o]", "o"],
  ["[0:a]channelsplit[l][r];[l]anullsink=bad;[r]anull[o]", "o"],
  ["[0:a]anullsink=bad=;[0:a]anull[o]", "o"],
  ["[missing]anullsink;[0:a]anull[o]", "o"],
  ["[0:a]no_such_filter,anullsink;[0:a]anull[o]", "o"],
  ["[0:a]no_such_filter[bad];[bad]anullsink;[0:a]anull[o]", "o"],
  ["[loop]anull[loop];[loop]anullsink;[0:a]anull[o]", "o"],
  ["[0:a]anullsink,anull[o]", "o"],
  ["[0:a][1:a]anullsink;[0:a]anull[o]", "o"],
  ["[0:a]channelsplit[l][r];[l]anullsink;[l]anull[o];[r]anullsink", "o"]
]) {
  it(`rejects invalid sink wiring without replacing output: ${graph}, map=${map}`, async () => {
    const volume = Volume.fromJSON({ "/out.wav": "keep" });
    volume.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000,
      channels: [left, right].map(values => Float64Array.from(values, value => value / 32768)) }));
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/a.wav", "-filter_complex", graph, "-map", `[${map}]`, "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}
