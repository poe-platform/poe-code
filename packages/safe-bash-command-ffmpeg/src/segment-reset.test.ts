import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

function source() {
  const doc = parseMp4(createSyntheticMp4({ width: 32, height: 32, frameCount: 20, fps: 4, includeAudio: false }));
  const track = doc.tracks[0]!;
  const source = { ...doc, tracks: [{ ...track,
    samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
  }] };
  return Volume.fromJSON({ "/in.mp4": Buffer.from(serializeMp4(source)) });
}

async function run(volume: Volume, options: string[] = []) {
  const args = ["-v", "error", "-i", "/in.mp4", "-c", "copy", "-f", "segment", ...options, "/p%02d.mp4"];
  const before = volume.toJSON();
  assert.equal(evalSyncFfmpeg(args, undefined,
    path => volume.readFileSync(path) as Buffer,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
  assert.deepEqual(volume.toJSON(), before);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr };
}

for (const reset of [undefined, "0", "1", "true"]) {
  it(`resets each segment independently (${reset})`, async () => {
    const volume = source();
    const result = await run(volume, reset === undefined ? [] : ["-reset_timestamps", reset]);
    assert.equal(result.exitCode, 0, result.stderr);
    const docs = [0, 1, 2].map(i => parseMp4(volume.readFileSync(`/p0${i}.mp4`) as Buffer));
    const tracks = docs.map(doc => doc.tracks[0]!);
    assert.deepEqual(tracks.map(track => track.samples.length), [8, 8, 4]);
    assert.deepEqual(docs.map(doc => {
      const track = doc.tracks[0]!;
      const delay = track.editList?.filter(edit => edit.mediaTime < 0).reduce((sum, edit) => sum + edit.segmentDuration, 0) ?? 0;
      const origin = track.editList?.find(edit => edit.mediaTime >= 0)?.mediaTime ?? 0;
      return delay / doc.timescale + (track.samples[0]!.pts - origin) / track.timescale;
    }),
      reset === "1" || reset === "true" ? [0, 0, 0] : [0, 2, 4]);
    assert.deepEqual(tracks.flatMap(track => track.samples.map(sample => sample.data)),
      parseMp4(volume.readFileSync("/in.mp4") as Buffer).tracks[0]!.samples.map(sample => sample.data));
  });
}

it("rejects invalid timestamp reset before replacing segments", async () => {
  const volume = source();
  volume.writeFileSync("/p00.mp4", "keep");
  const before = volume.toJSON();
  assert.notEqual((await run(volume, ["-y", "-reset_timestamps", "2"])).exitCode, 0);
  assert.deepEqual(volume.toJSON(), before);
});
