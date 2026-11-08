import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, probeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg testsrc2, 64x48, 5 fps, four seconds, libx264 -g 5 -keyint_min 5 -sc_threshold 0 -bf 0.
const fixture = readFileSync(new URL("./fixtures/output-seek.mp4", import.meta.url));
const source = parseMp4(fixture).tracks[0]!;
for (const sync of [false, true]) {
  for (const [before, after, first, count, pts] of [
    [[], [], 0, 20, 0],
    [[], ["-ss", "1.4"], 10, 10, 0.6],
    [[], ["-ss", "3.4"], 0, 0, 0],
    [[], ["-ss", "1.4", "-t", "0.4"], 0, 0, 0],
    [[], ["-ss", "1"], 5, 15, 0],
    [["-ss", "1.4"], [], 5, 15, -0.4],
  ] as const) {
    it(`${sync ? "sync" : "async"} stream copy seeks ${before.join(" ")} -i input ${after.join(" ")}`, async () => {
      const volume = Volume.fromJSON({ "/in.mp4": fixture });
      const args = ["-y", ...before, "-i", "/in.mp4", ...after, "-c:v", "copy", "/out.mp4"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const bytes = volume.readFileSync("/out.mp4") as Buffer;
      const samples = parseMp4(bytes).tracks.flatMap(track => track.samples);
      assert.equal(samples.length, count);
      assert.deepEqual(samples.map(sample => sample.data), source.samples.slice(first, first + count).map(sample => sample.data));
      const packets = probeMp4(bytes, { showPackets: true }).packets ?? [];
      assert.equal(packets.length, count);
      if (count) {
        const doc = parseMp4(bytes);
        const track = doc.tracks[0]!;
        let offset = 0;
        for (const edit of track.editList ?? []) {
          if (edit.mediaTime < 0) offset += edit.segmentDuration / doc.timescale;
          else { offset -= edit.mediaTime / track.timescale; break; }
        }
        assert.ok(Math.abs(samples[0]!.pts / track.timescale + offset - pts) < 0.0001);
      }
    });
  }
}
