import assert from "node:assert/strict";
import { it } from "node:test";
import { parseMkv } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Dialogue prefixes verified against native FFmpeg using these exact timing settings.
const cases = [
  ["X1:10 X2:50 Y1:20 Y2:60", String.raw`{\an5}{\pos(16,24)}`],
  ["", ""],
  ["X1:11 X2:52 Y1:21 Y2:62", String.raw`{\an5}{\pos(16,24)}`],
  ["X1:0 X2:15 Y1:0 Y2:7", String.raw`{\an5}{\pos(3,1)}`],
  ["X1:100 X2:100 Y1:200 Y2:200", String.raw`{\an1}{\pos(53,120)}`],
  ["X1:0 X2:0 Y1:0 Y2:0", String.raw`{\an1}{\pos(0,0)}`],
  ["X1:10 X2:50 Y1:20 Y2:20", String.raw`{\an5}{\pos(16,12)}`],
  ["X1:50 X2:10 Y1:20 Y2:60", String.raw`{\an1}{\pos(26,12)}`],
  ["X1:10 X2:50 Y1:20", String.raw`{\an1}{\pos(5,12)}`],
  ["X1:10 X2:50", ""],
  ["X1:10 X2:50 Y1:-1 Y2:60", ""]
];
for (const sync of [false, true]) {
  for (const extension of ["ass", "mkv"]) {
    it(`encodes SubRip positions as ${extension} through ${sync ? "sync" : "async"} execution`, async () => {
      const input = cases.map(([settings], index) =>
        `${index + 1}\n00:00:${String(index + 1).padStart(2, "0")},000 --> 00:00:${String(index + 2).padStart(2, "0")},000 ${settings}\n<i>alpha</i>\n\n`).join("");
      const volume = Volume.fromJSON({ "/in.srt": input });
      const target = `/out.${extension}`;
      const args = ["-y", "-v", "error", "-i", "/in.srt", "-c:s", "ass", target];
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
      if (extension === "ass") {
        assert.deepEqual(bytes.toString().split("\n").filter(line => line.startsWith("Dialogue:")),
          cases.map(([, prefix], index) => `Dialogue: 0,0:00:${String(index + 1).padStart(2, "0")}.00,0:00:${String(index + 2).padStart(2, "0")}.00,Default,,0,0,0,,${prefix}{\\i1}alpha{\\i0}`));
      } else {
        const track = parseMkv(bytes).tracks[0]!;
        assert.deepEqual(track.samples.map(sample => [sample.pts, sample.duration, Buffer.from(sample.data).toString()]),
          cases.map(([, prefix], index) => [(index + 1) * 1000, 1000, `${index},0,Default,,0,0,0,,${prefix}{\\i1}alpha{\\i0}`]));
      }
    });
  }
}
