import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const duration of [undefined, 3, 1.4]) {
  it(`stream-copies every video packet with concat duration ${duration}`, async () => {
    const inputs = [0, 120].map(red => createSyntheticMp4({
      width: 16, height: 16, fps: 5, frameCount: 10, color: [red, 40, 80]
    }));
    const volume = Volume.fromJSON({
      "/a.mp4": Buffer.from(inputs[0]!), "/b.mp4": Buffer.from(inputs[1]!),
      "/list.ffconcat": `ffconcat version 1.0\nfile a.mp4\n${duration === undefined ? "" : `duration ${duration}\n`}file b.mp4\n`
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-f", "concat", "-i", "/list.ffconcat", "-c", "copy", "/out.mp4"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const track = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
    assert.deepEqual(track.samples.map(sample => Buffer.from(sample.data)),
      inputs.flatMap(input => parseMp4(input).tracks[0]!.samples.map(sample => Buffer.from(sample.data))));
    // FFmpeg repairs overlapping DTS to one tick after the preceding packet.
    let previous = -1;
    const expected = Array.from({ length: 20 }, (_, index) => {
      const requested = Math.round((index < 10 ? index / 5 : (duration ?? 2) + (index - 10) / 5) * track.timescale);
      previous = Math.max(previous + 1, requested);
      return previous;
    });
    assert.deepEqual(track.samples.map(sample => sample.dts), expected);
    assert.deepEqual(track.samples.map(sample => sample.pts), expected);
    if (duration === 3) assert.equal(track.samples[9]!.duration / track.timescale, 1.2);
    assert.equal(track.samples.at(-1)!.pts / track.timescale, (duration ?? 2) + 1.8);
  });
}
