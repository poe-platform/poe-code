import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const type of ["mpegts", "fmp4"]) {
  for (const mode of ["date", "index", "disabled", "missing-strftime", "missing-index", "reset-flag", "remove-flag", "default", "percent"]) {
    it(`expands HLS strftime filenames: ${type}, ${mode}`, async (t) => {
      t.mock.method(Date, "now", () => Date.UTC(2026, 0, 2, 1, 2, 3));
      const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 10, frameCount: 34, includeAudio: false }));
      const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
        samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
      })) });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      const extension = type === "fmp4" ? "m4s" : "ts";
      const numbered = mode === "index" || mode === "missing-strftime";
      const pattern = mode === "disabled" ? `part-%03d.${extension}`
        : mode === "percent" ? `day-%Y-%%.${extension}` : numbered ? `s-%Y-%%03d.${extension}` : `day-%Y%m%d.${extension}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/in.mp4", "-c", "copy", "-hls_time", numbered ? "1" : "6", "-hls_list_size", "0",
          "-hls_segment_type", type, "-start_number", "7", "-strftime", mode === "disabled" || mode === "missing-strftime" ? "0" : "1",
          ...(numbered || mode === "missing-index" ? ["-hls_flags", "second_level_segment_index"] : []),
          ...(mode === "reset-flag" ? ["-hls_flags", "second_level_segment_index", "-hls_flags", "omit_endlist"] : []),
          ...(mode === "remove-flag" ? ["-hls_flags", "+second_level_segment_index", "-hls_flags", "-second_level_segment_index"] : []),
          ...(mode === "default" ? [] : ["-hls_segment_filename", pattern]), "/out.m3u8"],
        cwd: "/", env: { TZ: "America/Los_Angeles" }, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); },
          async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (mode === "missing-strftime" || mode === "missing-index") {
        assert.notEqual(result.exitCode, 0);
        assert.deepEqual(volume.readdirSync("/"), ["in.mp4"]);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const names = mode === "index" ? [7, 8, 9, 10].map(index => `s-2026-${String(index).padStart(3, "0")}.${extension}`)
        : [mode === "disabled" ? `part-007.${extension}` : mode === "default" ? `out-${Date.now() / 1000}.${extension}`
          : mode === "percent" ? `day-2026-%.${extension}` : `day-20260101.${extension}`];
      const playlist = String(volume.readFileSync("/out.m3u8"));
      assert.deepEqual(playlist.trim().split("\n").filter(line => !line.startsWith("#")), names);
      for (const name of names) assert.ok(volume.statSync("/" + name).size > 0);
    });
  }
}
