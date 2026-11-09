import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 5, frameCount: 20, includeAudio: false }));
const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
  samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 5 === 0 }))
})) });

async function run(flags: readonly string[], type = "mpegts", extra: string[] = [], existing: Record<string, string> = {}) {
  const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input), ...existing });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.mp4", "-c", "copy", "-f", "hls", "-hls_time", "1", "-hls_list_size", "0",
      "-hls_segment_type", type, ...flags.flatMap(flag => ["-hls_flags", flag]), ...extra, "/out.m3u8"],
    cwd: "/", env: { TZ: "UTC" }, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
      async rm(path: string) { volume.unlinkSync(path); },
      async rename(from: string, to: string) { volume.renameSync(from, to); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume };
}

for (const type of ["mpegts", "fmp4"]) {
  for (const [numeric, named] of [
    [["0"], []],
    [["1"], ["single_file"]],
    [["2"], ["delete_segments"]],
    [["4"], ["round_durations"]],
    [["8"], ["discont_start"]],
    [["16"], ["omit_endlist"]],
    [["32"], ["split_by_time"]],
    [["64"], ["append_list"]],
    [["128"], ["program_date_time"]],
    [["256"], ["second_level_segment_index"]],
    [["2048"], ["temp_file"]],
    [["8192"], ["independent_segments"]],
    [["16384"], ["iframes_only"]],
    [["21"], ["single_file+round_durations+omit_endlist"]],
    [["0x10"], ["omit_endlist"]],
    [["omit_endlist", "0"], []],
    [["single_file", "16"], ["omit_endlist"]],
    [["single_file", "+16"], ["single_file+omit_endlist"]],
    [["omit_endlist", "+0"], ["omit_endlist"]],
    [["21", "-17"], ["round_durations"]],
    [["16+single_file-16"], ["single_file"]],
    [["omit_endlist+4"], ["omit_endlist+round_durations"]],
    [["16", "round_durations"], ["round_durations"]],
    [["16", "-omit_endlist"], []]
  ] as const) {
    it(`matches named HLS flags for ${type} mask ${numeric.join(";")}`, async t => {
      t.mock.method(Date, "now", () => Date.UTC(2026, 0, 2, 1, 2, 3));
      const extra = numeric[0] === "256" ? ["-strftime", "1", "-hls_segment_filename", "part-%Y-%%03d.ts"]
        : numeric[0] === "2" ? ["-hls_list_size", "2"] : numeric[0] === "32" ? ["-hls_time", "0.5"] : [];
      const actual = await run(numeric, type, extra);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      const expected = await run(named, type, extra);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.deepEqual(actual.volume.toJSON(), expected.volume.toJSON());
      if (numeric.length === 1 && (numeric[0] === "0" || numeric[0] === "16")) {
        assert.equal(String(actual.volume.readFileSync("/out.m3u8")).includes("#EXT-X-ENDLIST"), numeric[0] === "0");
      }
    });
  }
}

for (const mask of ["512", "1024", "4096", "32768", "4294967312", "9007199254740992", "16.5", "NaN", "Infinity", "bogus"]) {
  it(`rejects unsupported HLS mask ${mask} before replacing output`, async () => {
    const { result, stderr, volume } = await run([mask], "mpegts", [], { "/out.m3u8": "keep playlist", "/out0.ts": "keep segment" });
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("unrecognized HLS flag"), stderr);
    assert.deepEqual(volume.toJSON(), { "/in.mp4": Buffer.from(input).toString(), "/out.m3u8": "keep playlist", "/out0.ts": "keep segment" });
  });
}
