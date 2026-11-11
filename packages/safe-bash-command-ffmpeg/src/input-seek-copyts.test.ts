import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2: seeking two samples retains PTS=2 under -copyts,
// including with -start_at_zero. Sample-count bounds still start at zero.
for (const format of ["s16le", "wav"]) {
  for (const flags of [[], ["-copyts"], ["-copyts", "-start_at_zero"]]) {
    for (const seek of [false, true]) {
      for (const complex of [false, true]) {
        for (const [filter, outputSeek] of [
          ["", undefined], ["atrim=start_pts=4", undefined], ["atrim=end_pts=4", undefined],
          ["atrim=start_sample=4", undefined], ["ashowinfo", undefined],
          ["", "0.000125"], ["", "0.0005"],
          ["atrim=start_pts=4", "0.000125"]
        ] as const) {
          if (complex && !filter) continue;
          it(`${format} input seek=${seek} ${flags.join(" ")} ${complex ? "graph" : "simple"} ${filter} output seek=${outputSeek}`, async () => {
            const input = Buffer.alloc(16);
            for (let i = 0; i < 8; i++) input.writeInt16LE(i + 1, i * 2);
            const file = format === "wav" ? Buffer.from(encodeWav({ sampleRate: 8000,
              channels: [Float64Array.from({ length: 8 }, (_, i) => (i + 1) / 32768)] })) : input;
            const volume = Volume.fromJSON({ "/in": file });
            const args = ["-y", "-v", "info", "-f", format,
              ...(format === "s16le" ? ["-ar", "8000", "-ac", "1"] : []),
              ...(seek ? ["-ss", "0.00025"] : []), ...flags, "-i", "/in",
              ...(filter ? complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter] : []),
              ...(outputSeek ? ["-ss", outputSeek] : []), "-f", "s16le", "/out"];
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
            const origin = seek && flags.includes("-copyts") ? 2 : 0;
            const skipped = seek ? 2 : 0;
            let start = filter === "atrim=start_sample=4" ? 4 : filter === "atrim=start_pts=4" ? 4 - origin : 0;
            const end = filter === "atrim=end_pts=4" ? skipped + 4 - origin : 8;
            if (outputSeek) start = Math.max(start, Number(outputSeek) * 8000 - origin);
            const expected = input.subarray((skipped + start) * 2, end * 2);
            assert.deepEqual(volume.readFileSync("/out"), expected);
            if (filter === "ashowinfo") {
              assert.ok(stderr.includes(`pts:${origin} pts_time:${origin / 8000}`), stderr);
            }
            if (!filter) {
              const sync = evalSyncFfmpeg(args, undefined,
                path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
                (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
              if (sync !== undefined) {
                assert.equal(sync, "");
                assert.deepEqual(volume.readFileSync("/out"), expected);
              }
            }
          });
        }
      }
    }
  }
}
