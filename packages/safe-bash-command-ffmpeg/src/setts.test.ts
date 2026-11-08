import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createSyntheticMp4, parseMp4, probeMp4, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { filterBitstream } from "./bitstream.js";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [filter, expected] of [
  ["null", [[0, 0, 20, 40]]],
  ["setts=ts=TS+200:duration=10", [[200, 200, 10, 40]]],
  ["setts=pts=PTS+300:dts=DTS+200", [[200, 300, 20, 40]]],
  ["setts=TS+100,setts=TS*2", [[200, 200, 20, 40]]],
  ["pcm_rechunk=n=8:p=0,setts=ts=N*20", [[0, 0, 8, 16], [20, 20, 8, 16], [40, 40, 4, 8]]]
] as const) {
  it(`applies ${filter} to copied PCM packet records`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 20 }, (_, i) => (i + 1) / 32768)] }));
    const result = await run(volume, ["-i", "/in.wav", "-c:a", "copy", "-bsf:a", filter, "-f", "framecrc", "-"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const rows = result.stdout.split("\n").filter(line => line && !line.startsWith("#")).map(line => line.split(",").map(s => s.trim()));
    assert.deepEqual(rows.map(row => row.slice(1, 5).map(Number)), expected);
    if (rows.length === 1) assert.equal(rows[0]![5], "0x0c0800d2");
  });
}

for (const sync of [false, true]) it(`preserves shifted timestamps and payloads in MP4 (sync=${sync})`, async () => {
  const input = createSyntheticMp4({ width: 16, height: 16, frameCount: 4, fps: 4 });
  const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
  const args = ["-y", "-i", "/in.mp4", "-c:v", "copy", "-bsf:v", "setts=ts=TS+9000", "/out.mp4"];
  if (sync) assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
  else { const result = await run(volume, args); assert.equal(result.exitCode, 0, result.stderr); }
  const before = parseMp4(input).tracks[0]!;
  const after = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
  const delay = after.editList![0]!.segmentDuration * after.timescale / parseMp4(input).timescale;
  assert.equal(after.editList![0]!.mediaTime, -1);
  assert.deepEqual(after.samples.map(s => [s.dts + delay, s.pts + delay, s.duration, Array.from(s.data)]),
    before.samples.map(s => [s.dts + 9000, s.pts + 9000, s.duration, Array.from(s.data)]));
});

async function run(volume: Volume, args: string[]) {
  let stdout = "", stderr = "";
  const result = await createFfmpegCommand().execute({ args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stdout, stderr };
}

for (const sync of [false, true]) for (const filter of ["setts=ts=TS+8000", "setts=ts=TS,setts=ts=TS+8000"]) it(`shifts AAC packets including priming (sync=${sync}, ${filter})`, async () => {
  const input = readFileSync(new URL("../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4", import.meta.url));
  const volume = Volume.fromJSON({ "/in.mp4": input });
  const args = ["-y", "-i", "/in.mp4", "-vn", "-c:a", "copy", "-bsf:a", filter, "/out.mp4"];
  if (sync) assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
  else { const result = await run(volume, args); assert.equal(result.exitCode, 0, result.stderr); }
  const output = volume.readFileSync("/out.mp4") as Buffer;
  const before = probeMp4(input, { showPackets: true }).packets!.filter(p => p.codec_type === "audio");
  const after = probeMp4(output, { showPackets: true }).packets!;
  assert.equal(parseMp4(output).tracks[0]!.duration, Math.max(...before.map(p => Number(p.pts) + Number(p.duration))) + 8000);
  assert.deepEqual(after.map(p => [p.dts, p.pts, p.duration]), before.map(p => [Number(p.dts) + 8000, Number(p.pts) + 8000, p.duration]));
  assert.deepEqual(parseMp4(output).tracks[0]!.samples.map(s => Array.from(s.data)),
    parseMp4(input).tracks.find(t => t.type === "audio")!.samples.map(s => Array.from(s.data)));
});

it("uses DTS for ts, respective timestamps for pts/dts, and nearest-even rounding", () => {
  const track = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 4 })).tracks[0]!;
  const tracks = [{ ...track, samples: track.samples.map((s, i) => ({ ...s, dts: i, pts: i + 10, cts: 10 })) }];
  for (const [filter, expected] of [
    ["setts=TS+200", [[200, 200], [201, 201], [202, 202], [203, 203]]],
    ["setts=pts=TS+200:dts=TS+100", [[100, 210], [101, 211], [102, 212], [103, 213]]],
    ["setts=N+0.5", [[0, 0], [2, 2], [2, 2], [4, 4]]]
  ] as const) {
    const output = filterBitstream(tracks, filter, new MediaBudgetTracker())[0]!;
    assert.deepEqual(output.samples.map(s => [s.dts, s.pts]), expected);
    for (const sample of output.samples) assert.equal(sample.cts, sample.pts - sample.dts);
  }
});

for (const filter of ["setts=", "setts=duration=", "setts=bad=1", "setts=UNKNOWN", "setts=duration=-1", "setts=1e30"]) {
  it(`rejects ${filter} before overwriting output`, async () => {
    const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(createSyntheticMp4({ width: 16, height: 16, frameCount: 1 })), "/out.mp4": "existing" });
    const args = ["-y", "-i", "/in.mp4", "-c:v", "copy", "-bsf:v", filter, "/out.mp4"];
    assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
      () => assert.fail("invalid setts must not write")), undefined);
    const result = await run(volume, args);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.mp4", "utf8"), "existing");
  });
}
