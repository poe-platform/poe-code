import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createSyntheticMp4, parseMp4, parseWav, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(volume: Volume, args: string[]) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", ...args],
    cwd: "/", env: {}, signal: new AbortController().signal,
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

for (const [suffix, name, escaped] of [
  ["ffconcat", "part", "part"],
  ["FFCONCAT", "part", "part"],
  ["ffconcat", "part '\\\t", "part\\ \\'\\\\\\\t"]
]) {
  it(`writes a reusable ${suffix} WAV segment manifest for ${JSON.stringify(name)}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/ramp.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 24000 }, (_, i) => i / 32768)] }));
    const list = `/list.${suffix}`;
    const result = await run(volume, ["-y", "-i", "/ramp.wav", "-c", "copy", "-f", "segment",
      "-segment_time", "1", "-segment_list", list, `/${name}%02d.wav`]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(volume.readFileSync(list, "utf8"),
      `ffconcat version 1.0\nfile ${escaped}00.wav\nfile ${escaped}01.wav\nfile ${escaped}02.wav\n`);
    assert.deepEqual([0, 1, 2].map(i =>
      parseWav(volume.readFileSync(`/${name}0${i}.wav`) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!.length),
    [8192, 8192, 7616]);
    const joined = await run(volume, [...(name === "part" ? [] : ["-safe", "0"]), "-i", list, "-c", "copy", "/joined.wav"]);
    assert.equal(joined.exitCode, 0, joined.stderr);
    assert.deepEqual(parseWav(volume.readFileSync("/joined.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0],
      parseWav(volume.readFileSync("/ramp.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]);
  });
}

it("writes ffconcat directives for MP4 segments", async () => {
  const doc = parseMp4(createSyntheticMp4({
    width: 32, height: 32, frameCount: 12, fps: 4, includeAudio: false
  }));
  const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(serializeMp4({ ...doc,
    tracks: doc.tracks.map(track => ({ ...track,
      samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
    }))
  })) });
  const result = await run(volume, ["-i", "/in.mp4", "-c", "copy", "-f", "segment",
    "-segment_time", "1", "-segment_list", "/list.ffconcat", "/part%02d.mp4"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const parts = volume.readdirSync("/").filter(name => String(name).startsWith("part"));
  assert.deepEqual(parts, ["part00.mp4", "part01.mp4", "part02.mp4"]);
  assert.equal(volume.readFileSync("/list.ffconcat", "utf8"),
    "ffconcat version 1.0\nfile part00.mp4\nfile part01.mp4\nfile part02.mp4\n");
  assert.deepEqual(parts.flatMap(name => parseMp4(volume.readFileSync(`/${name}`) as Buffer).tracks[0]!.samples.map(sample => sample.data)),
    parseMp4(volume.readFileSync("/in.mp4") as Buffer).tracks[0]!.samples.map(sample => sample.data));
});

it("protects an existing ffconcat list and only replaces it with -y", async () => {
  const volume = Volume.fromJSON({ "/list.ffconcat": "keep" });
  volume.writeFileSync("/ramp.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000)] }));
  const args = ["-i", "/ramp.wav", "-c", "copy", "-f", "segment", "-segment_list", "/list.ffconcat", "/part%02d.wav"];
  const before = volume.toJSON();
  assert.notEqual((await run(volume, args)).exitCode, 0);
  assert.deepEqual(volume.toJSON(), before);
  const result = await run(volume, ["-y", ...args]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(volume.readFileSync("/list.ffconcat", "utf8"), "ffconcat version 1.0\nfile part00.wav\n");
});
