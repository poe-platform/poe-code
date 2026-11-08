import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

function datetime(milliseconds: number): number {
  const date = new Date(milliseconds);
  return Number([date.getFullYear(), date.getMonth() + 1, date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds()].map(value => String(value).padStart(2, "0")).join(""));
}

for (const source of ["generic", "epoch", "epoch_us", "datetime", "invalid", ""]) {
  for (const type of ["mpegts", "fmp4"]) {
    for (const windowed of [false, true]) {
      it(`uses HLS start source ${source} for ${type}, windowed=${windowed}`, async () => {
        const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 10, frameCount: 34, includeAudio: false }));
        const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
          samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
        })) });
        const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
        let stderr = "";
        const before = Date.now();
        const result = await createFfmpegCommand().execute({
          args: ["-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_list_size", windowed ? "2" : "0",
            "-start_number", "37", "-hls_start_number_source", source, "-hls_segment_type", type,
            ...(windowed ? ["-hls_segment_filename", "/part%03d." + (type === "fmp4" ? "m4s" : "ts")] : []), "/out.m3u8"],
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
        const after = Date.now();
        if (source === "invalid" || source === "") {
          assert.notEqual(result.exitCode, 0);
          assert.ok(stderr.includes("hls_start_number_source"), stderr);
          assert.deepEqual(volume.readdirSync("/"), ["in.mp4"]);
          return;
        }
        assert.equal(result.exitCode, 0, stderr);
        const lines = String(volume.readFileSync("/out.m3u8")).trim().split("\n");
        const sequence = Number(lines.find(line => line.startsWith("#EXT-X-MEDIA-SEQUENCE:"))!.split(":")[1]);
        const start = sequence - (windowed ? 2 : 0);
        const lower = source === "generic" ? 37 : source === "epoch" ? Math.floor(before / 1000) : source === "epoch_us" ? before * 1000 : datetime(before);
        const upper = source === "generic" ? 37 : source === "epoch" ? Math.floor(after / 1000) : source === "epoch_us" ? after * 1000 : datetime(after);
        assert.ok(start >= lower && start <= upper, `${start} outside [${lower}, ${upper}]`);
        const extension = type === "fmp4" ? "m4s" : "ts";
        const names = Array.from({ length: 4 }, (_, index) =>
          `${windowed ? "part" : "out"}${String(start + index).padStart(windowed ? 3 : 1, "0")}.${extension}`);
        assert.deepEqual(lines.filter(line => !line.startsWith("#")), windowed ? names.slice(2) : names);
        for (const name of names) assert.ok(volume.statSync("/" + name).size > 0);
      });
    }
  }
}
