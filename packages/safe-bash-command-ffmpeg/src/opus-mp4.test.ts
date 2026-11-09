import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2: a 0.75-second, 48 kHz mono sine encoded with libopus,
// then copied from Ogg into Matroska and MP4. All three hold the same 38 packets.
const reference = parseMp4(new Uint8Array(readFileSync(new URL("../../mp4-ast/src/fixtures/opus-remux.mp4", import.meta.url))), { decodeAudio: false }).tracks[0]!;
for (const format of ["ogg", "mkv", "mp4"]) for (const sync of [false, true]) {
  for (const timing of [[], ["-copyts"], ["-copyts", "-start_at_zero"]]) {
    it(`${sync ? "sync" : "async"} copies ${format} Opus configuration and native MP4 timing ${timing.join(" ")}`, async () => {
      const input = readFileSync(new URL(`../../mp4-ast/src/fixtures/opus-remux.${format}`, import.meta.url));
      const volume = Volume.fromJSON({ [`/in.${format}`]: input });
      const args = ["-y", "-v", "error", ...timing, "-i", `/in.${format}`, ...(sync ? [] : ["-map", "0:a:0"]), "-c", "copy", "/out.mp4"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
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
      const output = parseMp4(new Uint8Array(volume.readFileSync("/out.mp4") as Buffer), { decodeAudio: false });
      const track = output.tracks[0]!;
      assert.deepEqual(track.codecDescriptions[0]!.dOps, reference.codecDescriptions[0]!.dOps);
      assert.equal(track.timescale, 48000);
      assert.deepEqual(track.samples.map(sample => sample.data), reference.samples.map(sample => sample.data));
      const mediaTime = format === "mkv" ? (timing.length === 1 ? 336 : 0) : 312;
      assert.equal(track.editList?.[0]?.mediaTime ?? 0, mediaTime);
      assert.equal(track.duration, format === "mkv" ? (timing.length === 1 ? 36192 : 36528) : 36000);
      assert.equal(track.samples[0]!.duration, format === "mkv" ? 1008 : 960);
      assert.equal(track.samples.at(-1)!.duration, format === "mkv" ? 960 : 792);
      assert.deepEqual(track.samples.map(sample => sample.dts), reference.samples.map((sample, index) => sample.dts + (format === "mkv" && index > 0 ? 48 : 0)));
    });
  }
}
