import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

async function run(volume: Volume, options: string[] = [], target = "/part%02d.wav") {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/a.wav", "-c", "copy", "-f", "segment", ...options, target],
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

function source() {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 24000 }, (_, i) => (i - 12000) / 32768)] }));
  return volume;
}

for (const [options, lengths] of [
  [[], [16384, 7616]],
  [["-segment_time", "1", "-segment_list", "/list.csv"], [8192, 8192, 7616]]
] as const) {
  it(`writes packet-aligned WAV segments and preserves every PCM sample (${options.join(" ") || "defaults"})`, async () => {
    const volume = source();
    const result = await run(volume, [...options]);
    assert.equal(result.exitCode, 0, result.stderr);
    const parts = volume.readdirSync("/").filter(name => String(name).startsWith("part"));
    assert.equal(parts.length, lengths.length);
    const pcm = parts.map(name => parseWav(volume.readFileSync(`/${name}`) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!);
    assert.deepEqual(pcm.map(channel => channel.length), lengths);
    assert.deepEqual(pcm.flatMap(channel => Array.from(channel)),
      Array.from(parseWav(volume.readFileSync("/a.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!));
    if (options.length) assert.equal(volume.readFileSync("/list.csv", "utf8"),
      "part00.wav,0.000000,1.024000\npart01.wav,1.024000,2.048000\npart02.wav,2.048000,3.000000\n");
  });
}

for (const wrap of [0, 1, 2, 4]) {
  it(`wraps segment filenames at ${wrap} while retaining chronological CSV rows`, async () => {
    const volume = source();
    const result = await run(volume, ["-y", "-segment_time", "1", "-segment_wrap", String(wrap), "-segment_list", "/list.csv"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const input = parseWav(volume.readFileSync("/a.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    const expected = new Map<string, number[]>();
    const boundaries = [0, 8192, 16384, 24000];
    const rows = [];
    for (let index = 0; index < 3; index++) {
      const name = `part${String(wrap ? index % wrap : index).padStart(2, "0")}.wav`;
      expected.set(name, Array.from(input.slice(boundaries[index], boundaries[index + 1])));
      rows.push(`${name},${(boundaries[index]! / 8000).toFixed(6)},${(boundaries[index + 1]! / 8000).toFixed(6)}\n`);
    }
    assert.deepEqual(volume.readdirSync("/").filter(name => String(name).startsWith("part")), [...expected.keys()]);
    for (const [name, samples] of expected) {
      assert.deepEqual(Array.from(parseWav(volume.readFileSync(`/${name}`) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!), samples);
    }
    assert.equal(volume.readFileSync("/list.csv", "utf8"), rows.join(""));
  });
}

it("allows wrapping within a run while protecting existing files and list collisions", async () => {
  const volume = source();
  const options = ["-segment_time", "1", "-segment_wrap", "2"];
  const result = await run(volume, options);
  assert.equal(result.exitCode, 0, result.stderr);
  const original = volume.readFileSync("/part00.wav");
  assert.notEqual((await run(volume, options)).exitCode, 0);
  assert.deepEqual(volume.readFileSync("/part00.wav"), original);
  assert.notEqual((await run(volume, ["-y", ...options, "-segment_list", "/part00.wav"])).exitCode, 0);
  assert.deepEqual(volume.readFileSync("/part00.wav"), original);
});

for (const value of ["-1", "1.5", "NaN", "Infinity", "2147483648", ""]) {
  it(`rejects invalid segment wrap ${JSON.stringify(value)} before writing`, async () => {
    const volume = source();
    assert.notEqual((await run(volume, ["-segment_wrap", value])).exitCode, 0);
    assert.deepEqual(volume.readdirSync("/"), ["a.wav"]);
  });
}

it("defers synchronous segment output to the asynchronous command without reporting false success", () => {
  const volume = source();
  assert.equal(evalSyncFfmpeg(["-y", "-i", "/a.wav", "-c", "copy", "-f", "segment", "/part%02d.wav"], undefined,
    path => volume.readFileSync(path) as Buffer,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
  assert.deepEqual(volume.readdirSync("/"), ["a.wav"]);
});

for (const [filename, type, csv] of [
  ["list.txt", undefined, false],
  ["list", undefined, false],
  ["list.custom", undefined, false],
  ["list.csv", "flat", false],
  ["list.CSV", undefined, true],
  ["list.ext", undefined, true],
  ["list.txt", "csv", true]
] as const) {
  it(`writes ${csv ? "CSV" : "flat"} segment lists for ${filename} (${type ?? "inferred"})`, async () => {
    const volume = source();
    const result = await run(volume, ["-segment_time", "1", "-segment_list", filename,
      ...(type === undefined ? [] : ["-segment_list_type", type])]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(volume.readFileSync(`/${filename}`, "utf8"), csv
      ? "part00.wav,0.000000,1.024000\npart01.wav,1.024000,2.048000\npart02.wav,2.048000,3.000000\n"
      : "part00.wav\npart01.wav\npart02.wav\n");
    const pcm = [0, 1, 2].map(index =>
      parseWav(volume.readFileSync(`/part0${index}.wav`) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!);
    assert.deepEqual(pcm.map(channel => channel.length), [8192, 8192, 7616]);
    assert.deepEqual(pcm.flatMap(channel => Array.from(channel)),
      Array.from(parseWav(volume.readFileSync("/a.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!));
  });
}

it("writes flat basenames verbatim and protects existing lists and input files", async () => {
  const volume = source();
  volume.mkdirSync("/segments");
  volume.writeFileSync("/list.txt", "keep");
  const before = volume.toJSON();
  assert.notEqual((await run(volume, ["-segment_list", "/list.txt"])).exitCode, 0);
  assert.deepEqual(volume.toJSON(), before);
  assert.notEqual((await run(volume, ["-y", "-segment_list", "/a.wav"])).exitCode, 0);
  assert.deepEqual(volume.toJSON(), before);
  assert.notEqual((await run(volume, ["-y", "-segment_list", "/part00.wav"])).exitCode, 0);
  assert.deepEqual(volume.toJSON(), before);
  const result = await run(volume, ["-y", "-segment_list", "/list.txt"], '/segments/part,"%02d.wav');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(volume.readFileSync("/list.txt", "utf8"), 'part,"00.wav\npart,"01.wav\n');
});

for (const type of ["", "invalid"]) {
  it(`rejects invalid segment list type ${JSON.stringify(type)} without writes`, async () => {
    const volume = source();
    const before = volume.toJSON();
    const result = await run(volume, ["-segment_list_type", type]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("segment_list_type"), result.stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}

for (const value of ["0", "-1", "NaN", "Infinity"]) {
  it(`rejects invalid segment duration ${value}`, async () => {
    const volume = source();
    assert.notEqual((await run(volume, ["-segment_time", value])).exitCode, 0);
    assert.deepEqual(volume.readdirSync("/"), ["a.wav"]);
  });
}

it("requires a numbered segment pattern", async () => {
  assert.notEqual((await run(source(), [], "/part.wav")).exitCode, 0);
});

it("preserves existing segment files unless overwrite is requested", async () => {
  const volume = source();
  volume.writeFileSync("/part00.wav", "keep");
  assert.notEqual((await run(volume)).exitCode, 0);
  assert.equal(volume.readFileSync("/part00.wav", "utf8"), "keep");
  assert.equal((await run(volume, ["-y"])).exitCode, 0);
  assert.equal(parseWav(volume.readFileSync("/part00.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!.length, 16384);
});

it("quotes CSV filenames and protects the list and inputs", async () => {
  const volume = source();
  volume.writeFileSync("/list.csv", "keep");
  assert.notEqual((await run(volume, ["-segment_list", "/list.csv"])).exitCode, 0);
  assert.deepEqual(volume.readdirSync("/"), ["a.wav", "list.csv"]);
  const input = volume.readFileSync("/a.wav");
  assert.notEqual((await run(volume, ["-y", "-segment_list", "/a.wav"])).exitCode, 0);
  assert.deepEqual(volume.readFileSync("/a.wav"), input);
  const result = await run(volume, ["-y", "-segment_list", "/list.csv"], '/part,"%02d.wav');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(volume.readFileSync("/list.csv", "utf8"),
    '"part,""00.wav",0.000000,2.048000\n"part,""01.wav",2.048000,3.000000\n');
});
