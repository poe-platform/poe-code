import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeH264Samples, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";
import fixtures from "./freezeframes-fixtures.json" with { type: "json" };

function frames(bytes: Uint8Array) {
  const track = parseMp4(bytes).tracks[0]!;
  // Native H.264 encodes may offset media timestamps for B-frames, then trim with an edit list.
  const start = (track.editList?.[0]?.mediaTime ?? 0) / track.timescale;
  return [...decodeH264Samples(track.samples, track.codecDescriptions, track.width!, track.height!, track.timescale)]
    .map(frame => ({ ...frame, ptsSeconds: frame.ptsSeconds - start }));
}

// Six distinct grayscale frames at 4 fps; references captured with native FFmpeg 7.0.2.
for (const [filter, reference, reversed = false] of [
  [undefined, "source"],
  ["[0:v][1:v]freezeframes=first=2:last=4:replace=1[v]", "native-freeze"],
  ["[0:v][1:v]freezeframes=first=3:last=3:replace=0[v]", "native-single"],
  ["freezeframes=2:4:1", "native-freeze"],
  ["[1:v:0][0:v:0]freezeframes=3:3:0[v]", "native-single", true],
] as const) {
  it(`freezeframes ${filter ?? "source control"} matches native pictures and timestamps`, async () => {
    const volume = Volume.fromJSON({
      "/source.mp4": Buffer.from(fixtures.source, "base64"),
      "/donor.mp4": Buffer.from(fixtures.donor, "base64")
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", reversed ? "/donor.mp4" : "/source.mp4",
        ...(filter ? ["-i", reversed ? "/source.mp4" : "/donor.mp4", "-filter_complex", filter,
          ...(filter.endsWith("[v]") ? ["-map", "[v]"] : [])] : []),
        "-c:v", "libx264", "/out.mp4"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const actual = frames(volume.readFileSync("/out.mp4") as Buffer);
    const expected = frames(Buffer.from(fixtures[reference], "base64"));
    assert.equal(actual.length, 6);
    assert.deepEqual(actual.map(frame => frame.ptsSeconds), [0, 0.25, 0.5, 0.75, 1, 1.25]);
    for (const [index, frame] of actual.entries()) {
      assert.equal(frame.ptsSeconds, expected[index]!.ptsSeconds);
      assert.equal(frame.durationSeconds, expected[index]!.durationSeconds);
      assert.deepEqual(frame.data, expected[index]!.data, `frame ${index}`);
    }
  });
}

for (const [filter, extra, limits] of [
  ["freezeframes=first=-1"],
  ["freezeframes=first=2:last=1"],
  ["freezeframes=replace=1.5"],
  ["freezeframes=replace="],
  ["freezeframes=replace=6"],
  ["freezeframes=unknown=1"],
  ["freezeframes=0:0:0:1"],
  ["[2:v][1:v]freezeframes"],
  ["[0:a][1:v]freezeframes"],
  ["[0:v][1:v:1]freezeframes"],
  ["freezeframes[v]", ["-map", "[missing]"]],
  ["freezeframes=2:4:1", [], { maxFrames: 9 }],
] as const) {
  it(`freezeframes rejects invalid graphs or exceeded limits without replacing output: ${filter}`, async () => {
    const volume = Volume.fromJSON({
      "/source.mp4": Buffer.from(fixtures.source, "base64"),
      "/donor.mp4": Buffer.from(fixtures.donor, "base64"),
      "/out.mp4": "existing output"
    });
    const before = volume.toJSON();
    let stderr = "";
    const result = await createFfmpegCommand({ limits }).execute({
      args: ["-y", "-v", "error", "-i", "/source.mp4", "-i", "/donor.mp4",
        "-filter_complex", filter, ...extra ?? [], "-c:v", "libx264", "/out.mp4"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0, stderr);
    assert.ok(stderr.includes(limits ? "maxFrames" : "freezeframes"), stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}
