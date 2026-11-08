import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const fixture = readFileSync(new URL("../../mp4-ast/src/fixtures/timecode.mp4", import.meta.url));
for (const [sync, map] of [[false, false], [false, true], [true, false]] as const) {
  for (const value of ["0", "1", "-1"]) {
    const enabled = value !== "0";
    for (const stamped of [false, true]) {
      it(`honors write_tmcd=${value} (sync=${sync}, map=${map}, stamped=${stamped})`, async () => {
        const input = stamped ? fixture : Buffer.from(createSyntheticMp4({ width: 32, height: 24, fps: 25, frameCount: 10, includeAudio: false }));
        const volume = Volume.fromJSON({ "/in.mp4": input });
        const args = ["-y", "-i", "/in.mp4", ...(map ? ["-map", "0:v"] : []), "-write_tmcd", value, "-c", "copy", "/out.mp4"];
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
        const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
        const video = output.tracks.find(track => track.type === "video")!;
        assert.equal(video.samples.length, 10);
        assert.deepEqual(video.samples.map(sample => sample.data), parseMp4(input).tracks[0]!.samples.map(sample => sample.data));
        assert.equal(output.tracks.length, enabled && stamped ? 2 : 1);
        if (enabled && stamped) {
          const timecode = output.tracks.find(track => track.handlerType === "tmcd")!;
          assert.equal(video.timecodeTrackId, timecode.id);
          assert.equal(timecode.samples.length, 1);
          assert.deepEqual(timecode.samples[0]!.data, parseMp4(input).tracks[1]!.samples[0]!.data);
          assert.deepEqual(timecode.codecDescriptions, parseMp4(input).tracks[1]!.codecDescriptions);
        } else {
          assert.equal(video.timecodeTrackId, undefined);
          assert.equal(video.metadata?.timecode, undefined);
        }
      });
    }
  }
}
