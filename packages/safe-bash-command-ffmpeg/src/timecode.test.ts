import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const option of [["-timecode", "01:02:03:04"], ["-metadata", "timecode=01:02:03:04"], ["-metadata:s:v:0", "timecode=01:02:03:04"]]) {
    it(`authors linked timecode: ${option[0]}, sync=${sync}`, async () => {
      const input = createSyntheticMp4({ width: 16, height: 16, frameCount: 10, fps: 25, includeAudio: false });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      async function run(options: string[]) {
        const args = ["-y", "-i", "/in.mp4", ...options, "-c", "copy", "/out.mp4"];
        if (sync && !options.includes("-map")) {
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
        return parseMp4(volume.readFileSync("/out.mp4") as Buffer);
      }
      const plain = await run([]);
      assert.equal(plain.tracks.length, 1);
      const output = await run(option);
      const video = output.tracks[0]!;
      const timecode = output.tracks[1]!;
      assert.equal(output.tracks.length, 2);
      assert.equal(video.timecodeTrackId, timecode.id);
      assert.equal(timecode.handlerType, "tmcd");
      assert.equal(timecode.samples.length, 1);
      assert.equal(new DataView(Uint8Array.from(timecode.samples[0]!.data).buffer).getInt32(0), 93079);
      assert.deepEqual(video.samples.map(s => s.data), plain.tracks[0]!.samples.map(s => s.data));
      volume.writeFileSync("/in.mp4", volume.readFileSync("/out.mp4"));
      const updated = await run(["-map", "0:v", "-metadata:s:v:0", "timecode=02:00:00:00"]);
      assert.equal(updated.tracks.length, 2);
      assert.equal(updated.tracks[0]!.timecodeTrackId, updated.tracks[1]!.id);
      assert.equal(new DataView(Uint8Array.from(updated.tracks[1]!.samples[0]!.data).buffer).getInt32(0), 180000);
    });
  }
}

it("uses the video frame rate and rejects malformed timecodes", async () => {
  const { authorTimecode } = await import("./timecode.js");
  const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 2, fps: 30, includeAudio: false }));
  const tracks = authorTimecode(doc.tracks, "01:00:00:00");
  assert.equal(new DataView(Uint8Array.from(tracks[1]!.samples[0]!.data).buffer).getInt32(0), 108000);
  for (const value of ["invalid", "01:60:00:00", "01:00:00:30", "01:00:00;00"]) {
    assert.throws(() => authorTimecode(doc.tracks, value), /Invalid timecode/);
  }
  assert.equal(authorTimecode(doc.tracks, undefined).length, 1);
});
