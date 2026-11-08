import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const fixture = readFileSync(new URL("../../mp4-ast/src/fixtures/timecode.mp4", import.meta.url));
for (const sync of [false, true]) {
  it(`preserves the timecode link in ordinary copy (sync=${sync})`, async () => {
    const volume = Volume.fromJSON({ "/in.mp4": fixture });
    const args = ["-y", "-i", "/in.mp4", "-c", "copy", "/out.mp4"];
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
    const timecode = output.tracks.find(track => track.handlerType === "tmcd")!;
    assert.equal(video.timecodeTrackId, timecode.id);
    assert.equal(video.samples.length, 10);
    assert.equal(timecode.samples.length, 1);
    assert.deepEqual(timecode.samples[0]!.data, parseMp4(fixture).tracks[1]!.samples[0]!.data);
  });
}
