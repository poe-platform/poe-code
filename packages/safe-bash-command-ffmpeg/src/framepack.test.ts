import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeH264Samples, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: three input frames produce two packed frames, at 0 and 0.5 s.
for (const layout of ["sbs", "tab", "format=sbs", "format=tab", "3", "4", ""]) {
  it(`framepack=${layout} preserves view order, timing and H.264 stereo signaling`, async () => {
    const vertical = layout === "tab" || layout === "format=tab" || layout === "4";
    const volume = Volume.fromJSON({
      "/left.mp4": readFileSync(new URL("./fixtures/framepack-left.mp4", import.meta.url)),
      "/right.mp4": readFileSync(new URL("./fixtures/framepack-right.mp4", import.meta.url))
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/left.mp4", "-i", "/right.mp4",
        "-filter_complex", `[0:v][1:v]framepack${layout ? `=${layout}` : ""}[v]`, "-map", "[v]", "-c:v", "libx264", "/out.mp4"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += Buffer.from(bytes).toString(); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const track = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
    assert.equal(track.width, vertical ? 16 : 32);
    assert.equal(track.height, vertical ? 32 : 16);
    assert.deepEqual(track.samples.map(sample => sample.pts / track.timescale), [0, 0.5]);
    assert.deepEqual(track.samples.map(sample => sample.duration / track.timescale), [0.5, 0.5]);
    const frames = [...decodeH264Samples(track.samples, track.codecDescriptions, track.width!, track.height!, track.timescale)];
    for (const [i, frame] of frames.entries()) {
      const offset = (vertical ? 16 * frame.width : 16) * 4;
      // Native decoded luma pairs: 40/180 and 64/208 (limited-range YUV).
      for (const [position, luma] of [[0, [40, 64][i]!], [offset, [180, 208][i]!]]) {
        const expected = Math.round((luma! - 16) * 255 / 219);
        assert.ok(Math.abs(frame.data[position!]! - expected) <= 2);
      }
    }
    const sample = track.samples[0]!.data;
    assert.equal(sample[4], 6, "first NAL is SEI");
    assert.equal(sample[5], 45, "frame_packing_arrangement SEI");
    assert.equal(((sample[7]! & 0x3f) << 1) | (sample[8]! >> 7), vertical ? 4 : 3);
    assert.equal(track.samples[0]!.isKeyframe, true);
  });
}

for (const [filter, secondInput, succeeds] of [
  ["[1:v][0:v]framepack=tab[v]", "color=blue:s=16x16:r=2:d=2", true],
  ["[0:v][1:v]framepack=bogus[v]", "color=blue:s=16x16:r=2:d=2", false],
  ["[0:v][1:v]framepack=sbs:shortest=0[v]", "color=blue:s=16x16:r=2:d=2", false],
  ["[0:v][1:v]framepack=sbs[v]", "color=blue:s=32x16:r=2:d=2", false],
  ["[0:v][1:v]framepack=sbs[v]", "color=blue:s=16x16:r=4:d=2", false]
] as const) {
  it(`framepack generated inputs: ${filter}, ${secondInput}`, async () => {
    const volume = Volume.fromJSON({ "/out.mp4": "keep existing output on error" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "lavfi", "-i", "color=red:s=16x16:r=2:d=1.5",
        "-f", "lavfi", "-i", secondInput, "-filter_complex", filter, "-map", "[v]", "/out.mp4"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += Buffer.from(bytes).toString(); } }
    } as never);
    assert.equal(result.exitCode, succeeds ? 0 : 1, stderr);
    if (!succeeds) {
      assert.match(stderr, /framepack:/);
      assert.equal(volume.readFileSync("/out.mp4", "utf8"), "keep existing output on error");
      return;
    }
    const track = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
    assert.deepEqual(track.samples.map(sample => sample.pts / track.timescale), [0, 0.5, 1]);
    const frames = [...decodeH264Samples(track.samples, track.codecDescriptions, track.width!, track.height!, track.timescale)];
    for (const frame of frames) {
      assert.deepEqual([...frame.data.subarray(0, 4)], [0, 0, 253, 255]);
      assert.deepEqual([...frame.data.subarray(16 * 16 * 4, 16 * 16 * 4 + 4)], [253, 0, 0, 255]);
    }
  });
}
