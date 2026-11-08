import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const stamped of [false, true]) {
  for (const map of ["0:v", "0"]) {
    it(`preserves mapped video timecode without duplicate or spurious tracks (${stamped}, ${map})`, async () => {
      const input = stamped
        ? readFileSync(new URL("../../mp4-ast/src/fixtures/timecode.mp4", import.meta.url))
        : createSyntheticMp4({ width: 32, height: 24, frameCount: 10, includeAudio: false });
      const source = parseMp4(Buffer.from(input));
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.mp4", "-map", map, "-c", "copy", "/out.mp4"],
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
      assert.equal(output.tracks.length, stamped ? 2 : 1);
      const video = output.tracks[0]!;
      assert.equal(video.samples.length, 10);
      assert.deepEqual(video.samples.map(sample => sample.data), source.tracks[0]!.samples.map(sample => sample.data));
      if (stamped) {
        const timecode = output.tracks[1]!;
        assert.equal(timecode.codecDescriptions[0]!.formatFourCC, "tmcd");
        assert.equal(timecode.samples.length, 1);
        assert.equal(video.timecodeTrackId, timecode.id);
        assert.deepEqual(timecode.samples[0]!.data, source.tracks[1]!.samples[0]!.data);
        assert.deepEqual(timecode.codecDescriptions[0]!.rawStsdEntryBytes, source.tracks[1]!.codecDescriptions[0]!.rawStsdEntryBytes);
      } else {
        assert.equal(video.timecodeTrackId, undefined);
      }
    });
  }
}
