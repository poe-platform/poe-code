import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import reference from "./stereo3d-reference.json" with { type: "json" };
import { createFfmpegCommand } from "./index.js";

for (const [filter, eye] of [
  ["stereo3d=sbsl:ml", "left"],
  ["stereo3d=sbsl:mr", "right"],
  ["stereo3d=in=sbsl:out=ml", "left"],
  ["stereo3d=out=mr", "right"],
  ["stereo3d=sbsl:mr:extra", null],
  ["stereo3d=in=sbsl:mr", null],
  ["stereo3d=sbsl:out=mr:unknown=1", null],
  ["stereo3d=abl:mr", null],
  ["stereo3d=sbsl:invalid", null],
  ["stereo3d", null],
] as const) {
  it(`${filter} ${eye ? "matches native eye pixels and timing" : "fails without replacing output"}`, async () => {
    const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(reference["packed.mp4"], "base64") });
    volume.writeFileSync("/out.mp4", "keep");
    const before = volume.toJSON();
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.mp4", "-vf", filter, "-c:v", "libx264", "/out.mp4"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (eye === null) {
      assert.notEqual(result.exitCode, 0);
      assert.match(stderr, /stereo3d:/);
      assert.deepEqual(volume.toJSON(), before);
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    const actual = parseMp4(volume.readFileSync("/out.mp4") as Buffer, { decodeFrames: true }).tracks[0]!;
    const expected = parseMp4(Buffer.from(reference[`native-${eye}.mp4`], "base64"), { decodeFrames: true }).tracks[0]!;
    assert.equal(actual.width, 16);
    assert.equal(actual.height, 16);
    assert.equal(actual.samples.length, 3);
    assert.deepEqual(actual.samples.map(sample => sample.duration / actual.timescale), [0.5, 0.5, 0.5]);
    assert.deepEqual(actual.decodedVideoFrames!.map(frame => frame.data), expected.decodedVideoFrames!.map(frame => frame.data));
    assert.deepEqual(actual.decodedVideoFrames!.map(frame => frame.ptsSeconds), [0, 0.5, 1]);
  });
}
