import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg: testsrc2=size=16x16:rate=5:duration=4 and
// sine=frequency=440:sample_rate=16000:duration=4, libx264 -g 1 and AAC.
const input = readFileSync(new URL("./fixtures/frame-limit-av.mp4", import.meta.url));
for (const sync of [false, true]) {
  for (const shortest of [false, true]) {
    it(`copies only whole video packets at the shortest AAC boundary (${sync ? "sync" : "async"}, shortest=${shortest})`, async () => {
      const source = parseMp4(input);
      const audio = source.tracks.find(track => track.type === "audio")!;
      // Native -t 1 retains the priming packet and 16 AAC presentation packets.
      const shortAudio = { ...audio, samples: audio.samples.slice(0, 17), duration: 16384,
        editList: audio.editList!.map(edit => ({ ...edit, segmentDuration: 16384 })) };
      const combined = serializeMp4({ ...source, tracks: source.tracks.map(track => track.type === "audio" ? shortAudio : track) });
      const short = serializeMp4({ ...source, timescale: source.timescale * 16, tracks: [{ ...shortAudio,
        editList: shortAudio.editList.map(edit => ({ ...edit, segmentDuration: edit.segmentDuration * 16 })) }] });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(combined), "/short.mp4": Buffer.from(short), "/both.mp4": input });
      const args = ["-y", ...(sync ? ["-i", "/in.mp4"] : ["-i", "/short.mp4", "-i", "/both.mp4", "-map", "1:v", "-map", "0:a"]),
        ...(shortest ? ["-shortest"] : []), "-c", "copy", "/out.mp4"];
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
      assert.equal(video.samples.length, shortest ? 5 : 20);
      assert.deepEqual(video.samples.map(({ pts, duration, data }) => ({ pts, duration, data })),
        source.tracks.find(track => track.type === "video")!.samples.slice(0, shortest ? 5 : 20).map(({ pts, duration, data }) => ({ pts, duration, data })));
      const outputAudio = output.tracks.find(track => track.type === "audio")!;
      assert.deepEqual(outputAudio.samples.map(({ pts, duration, data }) => ({ pts, duration, data })),
        shortAudio.samples.map(({ pts, duration, data }) => ({ pts, duration, data })));
      assert.equal(outputAudio.editList![0]!.mediaTime, 1024);
      assert.equal(output.durationSeconds, shortest ? 1.024 : 4);
    });
  }
}
