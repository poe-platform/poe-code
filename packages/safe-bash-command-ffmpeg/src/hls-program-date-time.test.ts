import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const type of ["mpegts", "fmp4"]) {
  for (const singleFile of [false, true]) {
    for (const flags of [[], ["program_date_time"], ["+program_date_time"], ["round_durations+program_date_time"], ["program_date_time", "-program_date_time"], ["program_date_time", "round_durations"]]) {
      it(`writes ${type} program dates with single_file=${singleFile}, flags=${flags.join(";")}`, async () => {
        const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 10, frameCount: 34, includeAudio: false }));
        const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
          samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
        })) });
        const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
        let stderr = "";
        const before = Date.now();
        const run = (extra: string[] = []) => createFfmpegCommand().execute({
          args: ["-i", "/in.mp4", "-c", "copy", "-hls_time", "1.05", "-hls_list_size", "0",
            "-hls_segment_type", type, ...flags.flatMap(flag => ["-hls_flags", flag]),
            ...(singleFile ? ["-hls_flags", "+single_file"] : []), ...extra, "/out.m3u8"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); },
            async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        const result = await run();
        assert.equal(result.exitCode, 0, stderr);
        const lines = String(volume.readFileSync("/out.m3u8")).trim().split("\n");
        const durations = lines.filter(line => line.startsWith("#EXTINF:")).map(line => Number(line.slice(8).split(",")[0]));
        const dates = lines.filter(line => line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")).map(line => Date.parse(line.slice(25)));
        const enabled = flags.length === 1;
        assert.equal(durations.length, 4);
        assert.equal(dates.length, enabled ? durations.length : 0);
        if (enabled) {
          assert.ok(dates[0]! >= before && dates[0]! <= Date.now());
          for (let i = 1; i < dates.length; i++) {
            assert.ok(Math.abs(dates[i]! - dates[i - 1]! - [1.1, 1, 1.1][i - 1]! * 1000) <= 1);
          }
          if (!singleFile) {
            const appended = await run(["-y", "-hls_flags", "+append_list", "-hls_list_size", "6"]);
            assert.equal(appended.exitCode, 0, stderr);
            const appendedLines = String(volume.readFileSync("/out.m3u8")).trim().split("\n");
            const appendedDates = appendedLines.filter(line => line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")).map(line => Date.parse(line.slice(25)));
            assert.equal(appendedDates.length, 6);
            assert.deepEqual(appendedDates.slice(0, 2), dates.slice(2));
          }
        }
      });
    }
  }
}
