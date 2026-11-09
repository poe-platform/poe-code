import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2's SubRip decoder drops closed overrides, with an alignment exception.
const cues = [
  [String.raw`A{\i1}B`, "AB"],
  [String.raw`{\b1}bold{\b0}`, "bold"],
  [String.raw`A{\foo}B{\pos(1,2)}C`, "ABC"],
  [String.raw`{\an8}Top`, String.raw`{\an8}Top`],
  [String.raw`A{\an8}B{\an3}C`, String.raw`A{\an8}BC`],
  [String.raw`{\an8}A{\i1}B`, String.raw`{\an8}A{\i1}B`],
  [String.raw`A{\an8\i1}B`, "AB"],
  [String.raw`A{\i1`, String.raw`A{\i1`],
  ["A{literal}B", "A{literal}B"],
  [String.raw`A{\i1}<b>B</b>`, String.raw`A{\b1}B{\b0}`]
];
const input = cues.map(([text], index) => `${index + 1}\n00:00:01,250 --> 00:00:03,500\n${text}\n`).join("\n");

for (const sync of [false, true]) {
  for (const format of ["ass", "mkv"]) {
    it(`discards SubRip overrides when encoding ${format} ASS (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/in.srt": input });
      const target = `/out.${format}`;
      const args = ["-y", "-v", "error", "-i", "/in.srt", ...(format === "mkv" ? ["-c:s", "ass"] : []), target];
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
      const bytes = volume.readFileSync(target) as Buffer;
      if (format === "ass") {
        assert.deepEqual(bytes.toString().split("\n").filter(line => line.startsWith("Dialogue:")),
          cues.map(([, expected]) => `Dialogue: 0,0:00:01.25,0:00:03.50,Default,,0,0,0,,${expected}`));
      } else {
        const track = parseMkv(bytes, { decodeSubtitles: false }).tracks[0]!;
        assert.equal(track.codecDescriptions[0]!.codecName, "ass");
        assert.deepEqual(track.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
          cues.map(([, expected], index) => [1250, 2250, `${index},0,Default,,0,0,0,,${expected}`]));
      }
    });
  }
}
