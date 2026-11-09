import assert from "node:assert/strict";
import { it } from "node:test";
import { parseMkv } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const captions = [
  ["A<br>B", "A\\NB"],
  ["A<BR>B", "A\\NB"],
  ["A<br/>B", "A\\NB"],
  ["A<br />B", "A\\NB"],
  ["A\nB", "A\\NB"],
  ["<i>A<br>B</i>\nC", "{\\i1}A\\NB{\\i0}\\NC"]
] as const;
const source = captions.map(([text], index) =>
  `${index + 1}\n00:00:${String(index + 1).padStart(2, "0")},000 --> 00:00:${String(index + 2).padStart(2, "0")},000\n${text}\n`
).join("\n");

for (const sync of [false, true]) {
  for (const format of ["ass", "mkv"]) {
    it(`encodes SubRip HTML and physical line breaks as ASS hard breaks in ${format} (sync=${sync})`, async () => {
      const target = `/out.${format}`;
      const volume = Volume.fromJSON({ "/in.srt": source });
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
        assert.equal(stderr, "");
      }
      const bytes = volume.readFileSync(target) as Buffer;
      if (format === "ass") {
        assert.deepEqual(bytes.toString().split("\n").filter(line => line.startsWith("Dialogue:")),
          captions.map(([, text], index) => `Dialogue: 0,0:00:0${index + 1}.00,0:00:0${index + 2}.00,Default,,0,0,0,,${text}`));
      } else {
        const track = parseMkv(bytes).tracks[0]!;
        assert.equal(track.codecDescriptions[0]!.codecName, "ass");
        assert.deepEqual(track.samples.map(sample => [sample.pts, sample.duration, Buffer.from(sample.data).toString()]),
          captions.map(([, text], index) => [(index + 1) * 1000, 1000, `${index},0,Default,,0,0,0,,${text}`]));
      }
    });
  }
}
