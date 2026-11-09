import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { BitReader, decodeH264Samples, parseMp4, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const source = readFileSync(new URL("./fixtures/h264-bframes-input.mp4", import.meta.url));

async function encode(bframes: string, extra: string[] = []) {
  const volume = Volume.fromJSON({ "/in.mp4": source, "/out.mp4": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.mp4", "-c:v", "libx264", "-bf", bframes, ...extra, "/out.mp4"],
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

for (const extra of [[], ["-movflags", "frag_keyframe+empty_moov"], ["-vf", "null"]]) {
  it(`encodes bounded B-frame runs without losing pictures (${extra.join(" ") || "MP4"})`, async () => {
    let reference: MediaVideoFrame[] = [];
    for (const count of [0, 1, 2, 16]) {
      const result = await encode(String(count), extra);
      assert.equal(result.exitCode, 0, result.stderr);
      const track = parseMp4(result.bytes).tracks.find(track => track.type === "video")!;
      assert.equal(track.samples.length, 24);
      const types = track.samples.map(sample => {
        const bits = new BitReader(sample.data.subarray(5));
        bits.readUE();
        return bits.readUE() % 5;
      });
      assert.equal(types.includes(1), count > 0, `-bf ${count}: B-slices`);
      let run = 0;
      for (const type of types) {
        run = type === 1 ? run + 1 : 0;
        assert.ok(run <= count, `-bf ${count}: ${run} consecutive B-frames`);
      }
      const frames = [...decodeH264Samples(track.samples, track.codecDescriptions, track.width!, track.height!, track.timescale)];
      assert.equal(frames.length, 24);
      frames.forEach((frame, i) => {
        assert.ok(Math.abs(frame.ptsSeconds - i / 12) < 0.00002);
        if (count > 0) assert.deepEqual(frame.data, reference[i]!.data, `picture ${i}`);
      });
      if (count === 0) reference = frames;
    }
  });
}

for (const value of ["invalid", "1.5", "-2", "2147483648"]) {
  it(`rejects invalid -bf ${value} without overwriting output`, async () => {
    const result = await encode(value);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /B-frame/);
    assert.equal(result.bytes.toString(), "KEEP");
  });
}

it("leaves encoded packets unchanged when -bf accompanies stream copy", async () => {
  const result = await encode("2", ["-c:v", "copy"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const before = parseMp4(source).tracks.find(track => track.type === "video")!;
  const after = parseMp4(result.bytes).tracks.find(track => track.type === "video")!;
  assert.deepEqual(after.samples.map(sample => sample.data), before.samples.map(sample => sample.data));
});
