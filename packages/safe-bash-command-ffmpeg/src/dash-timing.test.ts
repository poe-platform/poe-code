import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";

import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

it("copies DASH packets on one presentation timeline without AAC skip samples", async () => {
  const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 12, includeAudio: true, sampleRate: 8000 }));
  const resources = new Map<string, Uint8Array>();
  for (const track of source.tracks) {
    const audio = track.type === "audio";
    const timescale = audio ? 8000 : 16384;
    const count = audio ? 25 : 12;
    const duration = audio ? 1024 : 4096;
    resources.set(`${track.id}.mp4`, serializeMp4({ ...source, timescale,
      tracks: [{ ...track, timescale, samples: Array.from({ length: count }, (_, i) => ({
        ...track.samples[0]!, dts: i * duration, pts: i * duration, cts: 0,
        duration: audio && i === 24 ? 448 : duration
      })), editList: [{ segmentDuration: 0, mediaTime: audio ? 1024 : 0, mediaRateInteger: 1, mediaRateFraction: 0 }] }]
    }, { fragmented: true }));
  }
  const manifest = new TextEncoder().encode(`<MPD mediaPresentationDuration="PT3S"><Period><AdaptationSet>${source.tracks.map(track =>
    `<Representation id="${track.id}"><BaseURL>${track.id}.mp4</BaseURL></Representation>`).join("")}</AdaptationSet></Period></MPD>`);
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.mpd", manifest);
  for (const [uri, bytes] of resources) volume.writeFileSync(`/${uri}`, bytes);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-i", "/in.mpd", "-map", "0", "-c", "copy", "/out.mp4"],
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
  const doc = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
  const [video, audio] = doc.tracks;
  assert.equal(video!.samples.length, 12);
  assert.equal(audio!.samples.length, 24);
  assert.equal(video!.editList![0]!.mediaTime, -1);
  assert.equal(video!.editList![0]!.segmentDuration / doc.timescale, 0.127);
  assert.equal(audio!.editList?.find(edit => edit.mediaTime >= 0)?.mediaTime ?? 0, 0);
  assert.equal(audio!.samples[0]!.pts, 0);
  assert.equal(audio!.samples.at(-1)!.pts / audio!.timescale, 2.944);
});
