import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const videoTimescale of [undefined, 2000]) {
    for (const value of [undefined, "100", "1000", "0", "-1", "1.5", "2147483648", "bad"]) {
      it(`writes movie timescale ${value} (sync=${sync}, video=${videoTimescale})`, async () => {
        const base = parseMp4(createSyntheticMp4({ width: 64, height: 48, frameCount: 2, fps: 2 }));
        const input = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track,
          editList: [
            { segmentDuration: base.timescale / 4, mediaTime: -1, mediaRateInteger: 1, mediaRateFraction: 0 },
            { segmentDuration: base.timescale, mediaTime: 0, mediaRateInteger: 1, mediaRateFraction: 0 }
          ],
          codecDescriptions: track.codecDescriptions.map(codec => ({ ...codec, sarWidth: 4, sarHeight: 3 }))
        })) });
        const invalid = value !== undefined && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647);
        const source = parseMp4(input).tracks[0]!;
        const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
        const args = ["-y", "-i", "/in.mp4", "-c", "copy", ...(videoTimescale === undefined ? [] : ["-video_track_timescale", String(videoTimescale)]), ...(value === undefined ? [] : ["-movie_timescale", value]), "/out.mp4"];
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          if (invalid) {
            assert.notEqual(result, "");
            assert.equal(volume.existsSync("/out.mp4"), false);
            return;
          }
          assert.equal(result, "");
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
          if (invalid) {
            assert.notEqual(result.exitCode, 0);
            assert.equal(volume.existsSync("/out.mp4"), false);
            return;
          }
          assert.equal(result.exitCode, 0, stderr);
        }
        const output = parseMp4(new Uint8Array(volume.readFileSync("/out.mp4") as Buffer));
        const track = output.tracks[0]!;
        const audio = output.tracks.find(track => track.type === "audio")!;
        const sourceAudio = parseMp4(input).tracks.find(track => track.type === "audio")!;
        assert.equal(audio.timescale, sourceAudio.timescale);
        assert.deepEqual(audio.samples.map(s => [s.pts, s.dts, s.duration, s.data]),
          sourceAudio.samples.map(s => [s.pts, s.dts, s.duration, s.data]));
        const timescale = videoTimescale ?? source.timescale;
        assert.equal(track.timescale, timescale);
        assert.equal(track.duration, timescale);
        assert.deepEqual(track.editList?.map(edit => [edit.segmentDuration, edit.mediaTime]), [[output.timescale, 0]]);
        assert.deepEqual(track.samples.map(s => [s.pts, s.dts, s.duration]), [[0, 0, timescale / 2], [timescale / 2, timescale / 2, timescale / 2]]);
        assert.deepEqual(track.samples.map(s => s.data), source.samples.map(s => s.data));
        assert.deepEqual([track.width, track.height], [64, 48]);
        assert.deepEqual([track.codecDescriptions[0]!.sarWidth, track.codecDescriptions[0]!.sarHeight], [4, 3]);
      });
    }
  }
}
