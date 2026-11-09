import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createSyntheticMp4, parseMkv, parseMp4, parseWav, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

function source() {
  const doc = parseMp4(createSyntheticMp4({ width: 32, height: 32, frameCount: 20, fps: 4, includeAudio: false }));
  const track = doc.tracks[0]!;
  return Volume.fromJSON({ "/in.mp4": Buffer.from(serializeMp4({ ...doc, tracks: [{ ...track,
    samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
  }] })) });
}

async function run(volume: Volume, options: string[], extension = "mp4", outputExtension = extension) {
  const args = ["-y", "-v", "error", "-i", `/in.${extension}`, "-c", "copy", "-f", "segment",
    "-segment_list", "/list.csv", ...options, `/part%02d.${outputExtension}`];
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

for (const value of ["2.5", "+2.5", "2500ms", "2500000us", "00:00:02.500000", "0"]) {
  for (const reset of [false, true]) {
    it(`shifts segment packet timestamps, retaining cuts and payloads (${value}, reset=${reset})`, async () => {
      const volume = source();
      const offset = value === "0" ? 0 : 2.5;
      const result = await run(volume, ["-initial_offset", value, "-reset_timestamps", reset ? "1" : "0"]);
      assert.equal(result.exitCode, 0, result.stderr);
      const docs = [0, 1, 2].map(index => parseMp4(volume.readFileSync(`/part0${index}.mp4`) as Buffer));
      assert.deepEqual(docs.map(doc => doc.tracks[0]!.samples.length), [8, 8, 4]);
      const input = parseMp4(volume.readFileSync("/in.mp4") as Buffer).tracks[0]!;
      assert.deepEqual(docs.flatMap(doc => doc.tracks[0]!.samples.map(sample => sample.data)),
        input.samples.map(sample => sample.data));
      for (const [index, doc] of docs.entries()) {
        const track = doc.tracks[0]!;
        const editOffset = (track.editList ?? []).reduce((sum, edit) => sum +
          (edit.mediaTime < 0 ? edit.segmentDuration / doc.timescale : -edit.mediaTime / track.timescale), 0);
        for (const [packet, sample] of track.samples.entries()) {
          const expected = offset + (reset ? 0 : index * 2) + packet / 4;
          assert.equal(sample.pts / track.timescale + editOffset, expected);
          assert.equal(sample.dts / track.timescale + editOffset, expected);
        }
      }
      assert.equal(volume.readFileSync("/list.csv", "utf8"),
        "part00.mp4,0.000000,2.000000\npart01.mp4,2.000000,4.000000\npart02.mp4,4.000000,5.000000\n");
    });
  }
}

it("subtracts a negative offset from later segment timestamps without moving cuts", async () => {
  const volume = source();
  const result = await run(volume, ["-initial_offset", "-0.5"]);
  assert.equal(result.exitCode, 0, result.stderr);
  for (const index of [1, 2]) {
    const doc = parseMp4(volume.readFileSync(`/part0${index}.mp4`) as Buffer);
    const track = doc.tracks[0]!;
    const editOffset = (track.editList ?? []).reduce((sum, edit) => sum +
      (edit.mediaTime < 0 ? edit.segmentDuration / doc.timescale : -edit.mediaTime / track.timescale), 0);
    assert.equal(track.samples[0]!.pts / track.timescale + editOffset, index * 2 - 0.5);
    assert.equal(track.samples[0]!.dts / track.timescale + editOffset, index * 2 - 0.5);
  }
  assert.equal(volume.readFileSync("/list.csv", "utf8"),
    "part00.mp4,0.000000,2.000000\npart01.mp4,2.000000,4.000000\npart02.mp4,4.000000,5.000000\n");
});

// Native FFmpeg 7.0.2: initial_offset leaves WAV samples and CSV times unchanged.
for (const offset of ["2.5", "-2.5"]) {
  it(`accepts initial_offset ${offset} for WAV without changing PCM or CSV boundaries`, async () => {
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 24000 }, (_, frame) => frame / 32768)] })) });
    const result = await run(volume, ["-initial_offset", offset], "wav");
    assert.equal(result.exitCode, 0, result.stderr);
    const pcm = [0, 1].map(index => parseWav(volume.readFileSync(`/part0${index}.wav`) as Buffer)
      .tracks[0]!.decodedAudio!.channelData[0]!);
    assert.deepEqual(pcm.map(channel => channel.length), [16384, 7616]);
    assert.deepEqual(pcm.flatMap(channel => Array.from(channel)),
      Array.from(parseWav(volume.readFileSync("/in.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!));
    assert.equal(volume.readFileSync("/list.csv", "utf8"),
      "part00.wav,0.000000,2.048000\npart01.wav,2.048000,3.000000\n");
  });
}

for (const reset of [false, true]) {
  it(`shifts the PCM Matroska reproduction by 2.5 seconds (reset=${reset})`, async () => {
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 24000 }, (_, frame) => frame / 32768)] })) });
    const result = await run(volume, ["-initial_offset", "2.5", "-reset_timestamps", reset ? "1" : "0"], "wav", "mkv");
    assert.equal(result.exitCode, 0, result.stderr);
    const tracks = [0, 1].map(index => parseMkv(volume.readFileSync(`/part0${index}.mkv`) as Buffer).tracks[0]!);
    assert.deepEqual(tracks.map(track => track.samples[0]!.pts / track.timescale), reset ? [2.5, 2.5] : [2.5, 4.548]);
    const original = parseWav(volume.readFileSync("/in.wav") as Buffer).tracks[0]!;
    assert.deepEqual(tracks.flatMap((track, index) => track.samples.map(sample =>
      sample.pts * 1000 / track.timescale - 2500 + (reset && index === 1 ? 2048 : 0))),
    original.samples.map(sample => sample.pts * 1000 / original.timescale));
    assert.deepEqual(Buffer.concat(tracks.flatMap(track => track.samples.map(sample => sample.data))),
      Buffer.concat(original.samples.map(sample => sample.data)));
    assert.equal(volume.readFileSync("/list.csv", "utf8"),
      "part00.mkv,0.000000,2.048000\npart01.mkv,2.048000,3.000000\n");
  });
}

for (const value of ["", "NaN", "Infinity", "bad", "2.5junk", "1e999", "00:60:00"]) {
  it(`rejects invalid initial_offset ${JSON.stringify(value)} before replacing files`, async () => {
    const volume = source();
    volume.writeFileSync("/part00.mp4", "keep segment");
    volume.writeFileSync("/list.csv", "keep list");
    const before = volume.toJSON();
    const result = await run(volume, ["-initial_offset", value]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("initial_offset"), result.stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}
