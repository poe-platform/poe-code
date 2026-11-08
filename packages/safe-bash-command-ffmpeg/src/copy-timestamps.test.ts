import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

async function run(args: string[], sync: boolean, files: Record<string, Buffer>) {
  const volume = Volume.fromJSON(files);
  let stderr = "";
  const result = sync ? evalSyncFfmpeg(args, undefined,
    path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
    (path, data) => { volume.writeFileSync(path, data); return true; }) : await createFfmpegCommand().execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { volume, success: sync ? result === "" : (result as { exitCode: number }).exitCode === 0, stderr };
}

// Fixtures generated with native FFmpeg:
// ffmpeg -f lavfi -i testsrc2=size=16x16:rate=5:duration=1 -f lavfi
//   -i sine=frequency=440:sample_rate=16000:duration=1 -map 0:v -map 1:a
//   -c:v libx264 -g 1 -c:a aac base.mp4
// ffmpeg -i base.mp4 -map 0:v -map 0:a -c copy -output_ts_offset 2 shifted.mp4
// Native ffprobe packet PTS are the oracle; MP4 edit lists round to movie ticks.
for (const sync of [false, true]) {
  for (const [name, flags, fixture, starts] of [
    ["control", [], "base", [0, -0.064]],
    ["copy", ["-copyts"], "shifted", [2, 1.936]],
    ["copy unshifted", ["-copyts"], "base", [0, -0.064]],
    ["zero reversed flags", ["-start_at_zero", "-copyts"], "shifted", [0.063965, 0]],
    ["zero", ["-copyts", "-start_at_zero"], "shifted", [0.063965, 0]],
    ["zero alone", ["-start_at_zero"], "shifted", [0.063965, 0]],
  ] as const) {
    it(`${sync ? "sync" : "async"} stream copy timestamps: ${name}`, async () => {
      const result = await run(["-y", ...flags, "-i", "/in.mp4", "-c", "copy", "/out.mp4"], sync, {
        "/in.mp4": readFileSync(new URL(`./fixtures/timestamp-rebase/${fixture}.mp4`, import.meta.url))
      });
      assert.ok(result.success, result.stderr);
      const doc = parseMp4(result.volume.readFileSync("/out.mp4") as Buffer);
      const source = parseMp4(result.volume.readFileSync("/in.mp4") as Buffer);
      assert.deepEqual(doc.tracks.map(track => track.samples.map(sample => sample.data)),
        source.tracks.map(track => track.samples.map(sample => sample.data)));
      assert.deepEqual(doc.tracks.map(track => track.samples.length), [5, 17]);
      doc.tracks.forEach((track, index) => {
        let offset = 0;
        for (const edit of track.editList ?? []) {
          if (edit.mediaTime < 0) offset += edit.segmentDuration / doc.timescale;
          else { offset -= edit.mediaTime / track.timescale; break; }
        }
        const times = track.samples.map(sample => sample.pts / track.timescale + offset);
        assert.ok(Math.abs(times[0]! - starts[index]!) < 0.0001, `${track.type}: ${times[0]} != ${starts[index]}`);
        assert.ok(Math.abs(times.at(-1)! - (starts[index]! + (index === 0 ? 0.8 : 1.024))) < 0.0001);
      });
    });
  }
}
