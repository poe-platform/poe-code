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

for (const [frames, counts, starts] of [
  [undefined, [8, 8, 4], [0, 2, 4]],
  ["4,12", [4, 8, 8], [0, 1, 3]],
  ["3,9", [4, 8, 8], [0, 1, 3]],
  ["100", [20], [0]]
] as const) {
  it(`cuts MP4 at reference frame numbers, waiting for keyframes (${frames ?? "default"})`, async () => {
    const volume = source();
    const result = await run(volume, frames ? ["-segment_frames", frames] : []);
    assert.equal(result.exitCode, 0, result.stderr);
    const outputs = volume.readdirSync("/").filter(name => String(name).startsWith("p"));
    const tracks = outputs.map(name => parseMp4(volume.readFileSync(`/${name}`) as Buffer).tracks[0]!);
    assert.deepEqual(tracks.map(track => track.samples.length), counts);
    assert.deepEqual(outputs.map(name => {
      const doc = parseMp4(volume.readFileSync(`/${name}`) as Buffer);
      const track = doc.tracks[0]!;
      return track.samples[0]!.pts / track.timescale + (track.editList ?? []).reduce((offset, edit) =>
        offset + (edit.mediaTime < 0 ? edit.segmentDuration / doc.timescale : -edit.mediaTime / track.timescale), 0);
    }), starts);
    assert.deepEqual(tracks.flatMap(track => track.samples.map(sample => sample.data)),
      parseMp4(volume.readFileSync("/in.mp4") as Buffer).tracks[0]!.samples.map(sample => sample.data));
  });
}

for (const frames of ["", "-1", "4,3", "x", "1.5", "4,", "2147483648"]) {
  it(`rejects invalid frame list ${JSON.stringify(frames)} without writing`, async () => {
    const volume = source();
    const before = volume.toJSON();
    assert.notEqual((await run(volume, ["-segment_frames", frames])).exitCode, 0);
    assert.deepEqual(volume.toJSON(), before);
  });
}

it("protects existing MP4 segments and overwrites only with -y", async () => {
  const volume = source();
  volume.writeFileSync("/p01.mp4", "keep");
  const before = volume.toJSON();
  assert.notEqual((await run(volume, ["-segment_frames", "4,12"])).exitCode, 0);
  assert.deepEqual(volume.toJSON(), before);
  const result = await run(volume, ["-y", "-segment_frames", "4,12"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(parseMp4(volume.readFileSync("/p01.mp4") as Buffer).tracks[0]!.samples.length, 8);
});
