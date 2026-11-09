import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, probeMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

function source() {
  const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 4, frameCount: 20 }));
  return Volume.fromJSON({ "/in.mp4": Buffer.from(serializeMp4({ ...doc,
    tracks: doc.tracks.map(track => ({ ...track,
      samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
    }))
  })) });
}

async function run(volume: Volume, options: string[]) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.mp4", "-c", "copy", "-f", "segment", ...options, "/p%02d.mp4"],
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

for (const [options, counts, starts] of [
  [[], [8, 8, 4], [0, 2, 4]],
  [["-segment_times", "0.6,2.1"], [4, 8, 8], [0, 1, 3]],
  [["-segment_times", "1.1,3.1", "-segment_time_delta", "0.1"], [4, 8, 8], [0, 1, 3]],
  [["-segment_times", "1.1,3.1", "-segment_time_delta", "0.04"], [8, 8, 4], [0, 2, 4]],
  [["-segment_times", "1,3"], [4, 8, 8], [0, 1, 3]],
  [["-segment_times", "00:00:01,3000ms,9"], [4, 8, 8], [0, 1, 3]]
] as const) {
  it(`splits MP4 packets at keyframes: ${options.join(" ") || "defaults"}`, async () => {
    const volume = source();
    const result = await run(volume, [...options]);
    assert.equal(result.exitCode, 0, result.stderr);
    const tracks = volume.readdirSync("/").filter(name => String(name).startsWith("p")).map(name =>
      parseMp4(volume.readFileSync(`/${name}`) as Buffer).tracks[0]!);
    assert.deepEqual(tracks.map(track => track.samples.length), counts);
    assert.deepEqual(volume.readdirSync("/").filter(name => String(name).startsWith("p")).map(name =>
      Number(probeMp4(volume.readFileSync(`/${name}`) as Buffer).streams[0]!.start_time)), starts);
    const original = parseMp4(volume.readFileSync("/in.mp4") as Buffer).tracks[0]!;
    assert.deepEqual(tracks.flatMap(track => track.samples.map(sample => sample.data)), original.samples.map(sample => sample.data));
  });
}

for (const value of ["", "bad", "1,no", "2,1", "-1", "Infinity", "1,", "1junk"]) {
  it(`rejects invalid segment_times ${JSON.stringify(value)} without writes`, async () => {
    const volume = source();
    const before = volume.toJSON();
    assert.notEqual((await run(volume, ["-segment_times", value])).exitCode, 0);
    assert.deepEqual(volume.toJSON(), before);
  });
}

it("protects existing segments and writes the actual cut times in the list", async () => {
  const volume = source();
  volume.writeFileSync("/p01.mp4", "keep");
  const before = volume.toJSON();
  assert.notEqual((await run(volume, ["-segment_times", "1,3"])).exitCode, 0);
  assert.deepEqual(volume.toJSON(), before);
  const result = await run(volume, ["-y", "-segment_times", "1,3", "-segment_list", "/list.csv"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(volume.readFileSync("/list.csv", "utf8"),
    "p00.mp4,0.000000,1.000000\np01.mp4,1.000000,3.000000\np02.mp4,3.000000,5.000000\n");
});
