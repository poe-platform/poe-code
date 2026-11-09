import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, createFfprobeCommand, evalSyncFfmpeg } from "./index.js";

const source = readFileSync(new URL("./fixtures/force-key-frames.mp4", import.meta.url));

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

// Native FFmpeg 7.0.2: eight frames at 4 fps, no scene-change keyframes.
for (const [value, keys] of [
  [undefined, [0]], ["0.75", [0, 3]], ["0.5,1.25", [0, 2, 5]],
  ["1.25,0.5", [0, 2, 5]], ["00:00:00.75", [0, 3]]
] as const) {
  it(`encodes forced H.264 keyframes: ${value ?? "control"}`, async () => {
    const volume = Volume.fromJSON({ "/source.mp4": source });
    const options = value === undefined ? [] : ["-force_key_frames", value];
    const result = await run(volume, ["-v", "error", "-i", "/source.mp4", "-c:v", "libx264", ...options, "/out.mp4"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const probe = await run(volume, ["-v", "error", "-select_streams", "v", "-show_frames",
      "-show_entries", "frame=pts_time,key_frame", "-of", "json", "/out.mp4"], true);
    assert.equal(probe.exitCode, 0, probe.stderr);
    const frames = JSON.parse(probe.stdout).frames as { pts_time: string; key_frame: number }[];
    assert.deepEqual(frames.map(frame => Number(frame.pts_time)), Array.from({ length: 8 }, (_, i) => i / 4));
    assert.deepEqual(frames.map(frame => frame.key_frame), Array.from({ length: 8 }, (_, i) => Number((keys as readonly number[]).includes(i))));
    if (value !== undefined) {
      const samples = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!.samples;
      assert.deepEqual(samples.map(sample => Number((sample.data[4]! & 31) === 5)), frames.map(frame => frame.key_frame));
    }
  });
}

for (const value of ["", "bad", "0.5,no", "1,", "Infinity", "expr:gte(t,1)"]) {
  it(`rejects invalid forced timestamps without replacing output: ${value}`, async () => {
    const volume = Volume.fromJSON({ "/source.mp4": source, "/out.mp4": "keep" });
    const result = await run(volume, ["-y", "-i", "/source.mp4", "-force_key_frames", value, "/out.mp4"]);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.mp4", "utf8"), "keep");
  });
}

it("defers forced keyframe encoding to the asynchronous command", () => {
  assert.equal(evalSyncFfmpeg(source, ["-i", "pipe:0", "-force_key_frames", "0.75", "-f", "mp4", "pipe:1"]), undefined);
});
