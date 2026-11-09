import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, createFfprobeCommand, evalSyncFfmpeg } from "./index.js";

const source = readFileSync(new URL("./fixtures/h264-preset.mp4", import.meta.url));

async function run(volume: Volume, args: string[], probe = false) {
  let stdout = "", stderr = "";
  const result = await (probe ? createFfprobeCommand() : createFfmpegCommand()).execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stdout, stderr };
}

// Native FFmpeg 7.0.2 on this 24-frame fixture: ultrafast is baseline, medium is high.
for (const [preset, profile, bFrames] of [["ultrafast", "Constrained Baseline", 0], ["medium", "High", 2]] as const) {
  it(`configures the H.264 encoder with ${preset}`, async () => {
    const volume = Volume.fromJSON({ "/input.mp4": source });
    const result = await run(volume, ["-i", "/input.mp4", "-vf", "hflip", "-c:v", "libx264", "-preset", preset, "/out.mp4"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const probe = await run(volume, ["-show_entries", "stream=profile,has_b_frames,nb_frames", "-of", "json", "/out.mp4"], true);
    assert.equal(probe.exitCode, 0, probe.stderr);
    assert.deepEqual(JSON.parse(probe.stdout).streams, [{ profile, has_b_frames: bFrames, nb_frames: "24" }]);
    const frames = parseMp4(volume.readFileSync("/out.mp4") as Buffer, { decodeFrames: true }).tracks[0]!.decodedVideoFrames!;
    assert.equal(frames.length, 24);
  });
}

it("rejects unknown presets without creating output", async () => {
  const volume = Volume.fromJSON({ "/input.mp4": source });
  const result = await run(volume, ["-i", "/input.mp4", "-vf", "hflip", "-c:v", "libx264", "-preset", "not-a-preset", "/out.mp4"]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /invalid preset 'not-a-preset'/);
  assert.equal(volume.existsSync("/out.mp4"), false);
});

it("defers preset encoding to the asynchronous command", () => {
  assert.equal(evalSyncFfmpeg(source, ["-i", "pipe:0", "-preset", "medium", "-f", "mp4", "pipe:1"]), undefined);
});

it("applies scoped presets without requiring a filter", async () => {
  const volume = Volume.fromJSON({ "/input.mp4": source });
  const result = await run(volume, ["-i", "/input.mp4", "-c:v", "libx264", "-preset:v:0", "ultrafast", "/out.mp4"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const track = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
  assert.equal(track.codecDescriptions[0]!.profile, "Constrained Baseline");
  assert.equal(track.samples.length, 24);
});

it("ignores encoder presets during stream copy", async () => {
  const volume = Volume.fromJSON({ "/input.mp4": source });
  const result = await run(volume, ["-i", "/input.mp4", "-c:v", "copy", "-preset", "not-a-preset", "/out.mp4"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!.samples.map(sample => sample.data),
    parseMp4(source).tracks[0]!.samples.map(sample => sample.data));
});

it("preserves existing output when a preset is invalid", async () => {
  const volume = Volume.fromJSON({ "/input.mp4": source, "/out.mp4": "keep" });
  const result = await run(volume, ["-y", "-i", "/input.mp4", "-preset", "invalid", "/out.mp4"]);
  assert.notEqual(result.exitCode, 0);
  assert.equal(volume.readFileSync("/out.mp4", "utf8"), "keep");
});

it("rejects a missing preset value", async () => {
  const volume = Volume.fromJSON({ "/input.mp4": source });
  const result = await run(volume, ["-i", "/input.mp4", "-preset"]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /Missing value for -preset/);
});

it("honors explicit B-frame limits with a preset", async () => {
  const volume = Volume.fromJSON({ "/input.mp4": source });
  const result = await run(volume, ["-i", "/input.mp4", "-preset", "medium", "-bf", "0", "/out.mp4"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const probe = await run(volume, ["-show_entries", "stream=has_b_frames,nb_frames", "-of", "json", "/out.mp4"], true);
  assert.deepEqual(JSON.parse(probe.stdout).streams, [{ has_b_frames: 0, nb_frames: "24" }]);
});

it("keeps zerolatency tuning when applying a preset", async () => {
  const volume = Volume.fromJSON({ "/input.mp4": source });
  const result = await run(volume, ["-i", "/input.mp4", "-preset", "medium", "-tune", "zerolatency", "/out.mp4"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const probe = await run(volume, ["-show_entries", "stream=has_b_frames,nb_frames", "-of", "json", "/out.mp4"], true);
  assert.deepEqual(JSON.parse(probe.stdout).streams, [{ has_b_frames: 0, nb_frames: "24" }]);
});
