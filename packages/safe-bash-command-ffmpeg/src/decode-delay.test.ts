import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeH264Samples, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: -i INPUT -vf hflip -c:v libx264 -bf 0 out.mp4.
// Both inputs contain the same 24 pictures; only bframes has decode preroll.
for (const name of ["bframes", "ordered"]) {
  for (const copy of [false, true]) {
    it(`${copy ? "preserves copied timing" : "removes input decode delay on re-encode"}: ${name}`, async () => {
      const input = readFileSync(new URL(`./fixtures/decode-delay-${name}.mp4`, import.meta.url));
      const volume = Volume.fromJSON({ "/in.mp4": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.mp4",
          ...(copy ? ["-c:v", "copy"] : ["-vf", "hflip", "-c:v", "libx264", "-bf", "0"]), "/out.mp4"],
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
      const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
      const track = output.tracks[0]!;
      assert.equal(track.timescale, 12288);
      assert.equal(track.samples.length, 24);
      const timestamps = track.samples.map(({ pts, dts }) => [pts, dts]);
      if (copy) {
        const original = parseMp4(input).tracks[0]!;
        assert.deepEqual(timestamps, original.samples.map(({ pts, dts }) => [pts, dts]));
        assert.deepEqual(track.editList, original.editList);
        assert.deepEqual(track.samples.map(sample => sample.data), original.samples.map(sample => sample.data));
      } else {
        let offset = 0;
        for (const edit of track.editList ?? []) {
          if (edit.mediaTime < 0) offset += edit.segmentDuration * track.timescale / output.timescale;
          else { offset -= edit.mediaTime; break; }
        }
        assert.deepEqual(timestamps.map(([pts, dts]) => [pts! + offset, dts! + offset]),
          Array.from({ length: 24 }, (_, i) => [i * 1024, i * 1024]));
        assert.equal([...decodeH264Samples(track.samples, track.codecDescriptions, track.width!, track.height!, track.timescale)].length, 24);
      }
    });
  }
}
