import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg fixture: four seconds of moving 128x96 video at 12 fps.
const input = readFileSync(new URL("./fixtures/h264-bitrate-input.mp4", import.meta.url));

async function run(options: string[], features?: Parameters<typeof createFfmpegCommand>[0]) {
  const volume = Volume.fromJSON({ "/in.mp4": input, "/out.mp4": "keep" });
  let stderr = "";
  const result = await createFfmpegCommand(features).execute({
    args: ["-y", "-i", "/in.mp4", "-c:v", "libx264", ...options, "/out.mp4"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, bytes: volume.readFileSync("/out.mp4") as Buffer };
}

for (const filter of [[], ["-vf", "hflip"]]) {
  it(`applies average bitrate and retains every frame ${filter.length ? "with hflip" : "without filters"}`, async () => {
    const sizes: number[] = [];
    for (const rate of ["20k", "200k"]) {
      const result = await run([...filter, "-b:v", rate]);
      assert.equal(result.exitCode, 0, result.stderr);
      const track = parseMp4(result.bytes, { decodeFrames: true }).tracks[0]!;
      assert.equal(track.samples.length, 48);
      assert.equal(track.decodedVideoFrames?.length, 48);
      assert.equal(track.duration / track.timescale, 4);
      assert.equal(track.width, 128);
      assert.equal(track.height, 96);
      sizes.push(track.samples.reduce((sum, sample) => sum + sample.size, 0));
    }
    assert.ok(sizes[0]! * 3 < sizes[1]!, `20k: ${sizes[0]} bytes; 200k: ${sizes[1]} bytes`);
  });
}

it("accepts equivalent bitrate units and combines bitrate with preset, B-frame and keyframe settings", async () => {
  const outputs = [];
  for (const rate of ["20000", "0.02M"]) {
    const result = await run(["-b:v", rate, "-preset", "ultrafast", "-bf", "0", "-force_key_frames", "1,2"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const track = parseMp4(result.bytes).tracks[0]!;
    assert.ok(track.samples.every(sample => sample.dts === sample.pts));
    assert.ok(track.samples.some(sample => sample.isKeyframe && sample.pts === track.timescale));
    assert.ok(track.samples.some(sample => sample.isKeyframe && sample.pts === track.timescale * 2));
    outputs.push(result.bytes);
  }
  assert.deepEqual(outputs[0], outputs[1]);
});

it("keeps stream-copy packets unchanged when bitrate is specified", async () => {
  const result = await run(["-c:v", "copy", "-b:v", "20k"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(parseMp4(result.bytes).tracks[0]!.samples.map(sample => sample.data),
    parseMp4(input).tracks[0]!.samples.map(sample => sample.data));
});

it("defers synchronous bitrate encoding to the cooperative command", () => {
  let written = false;
  assert.equal(evalSyncFfmpeg(["-i", "/in.mp4", "-b:v", "20k", "/out.mp4"], undefined,
    () => input, () => { written = true; return true; }), undefined);
  assert.equal(written, false);
});

it("honors the video transcoding feature gate", async () => {
  const result = await run(["-b:v", "20k"], { features: { videoTranscode: false } });
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.bytes.toString(), "keep");
});

for (const rate of ["", "k", "bogus", "-1", "NaN", "Infinity", "2147483648", "1.5"]) {
  it(`rejects invalid video bitrate ${JSON.stringify(rate)} before replacing output`, async () => {
    const result = await run(["-b:v", rate]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Invalid video bitrate/);
    assert.equal(result.bytes.toString(), "keep");
  });
}
