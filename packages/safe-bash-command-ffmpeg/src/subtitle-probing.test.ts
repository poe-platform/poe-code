import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseSubtitleDocument } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const srt = "1\n00:00:01,000 --> 00:00:03,500\nCafé costs €2\n\n2\n00:00:02,250 --> 00:00:05,000\nSecond line\n\n";
for (const numbered of [false, true]) {
  for (const forced of [false, true]) {
    for (const sync of [false, true]) {
      it(`${sync ? "sync" : "async"} ${forced ? "forced" : "detected"} ${numbered ? "numbered" : "unnumbered"} SRT`, async () => {
        const bytes = Buffer.from(numbered ? srt : srt.replace("1\n00", "00").replace("2\n00", "00"));
        const accepted = numbered || forced;
        const volume = Volume.fromJSON({ "/in.srt": bytes });
        const args = ["-v", "error", "-y", ...(forced ? ["-f", "srt"] : []), "-i", "/in.srt", "/out.vtt"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, data) => { volume.writeFileSync(path, data); return true; }), accepted ? "" : undefined);
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
          } as never);
          assert.equal(result.exitCode === 0, accepted, stderr);
        }
        if (!accepted) {
          assert.equal(volume.existsSync("/out.vtt"), false);
          return;
        }
        const output = parseSubtitleDocument(volume.readFileSync("/out.vtt") as Buffer, "webvtt");
        assert.deepEqual(output.tracks[0]!.samples.map(sample => [
          sample.pts, sample.duration, new TextDecoder().decode(sample.data)
        ]), [[1000, 2500, "Café costs €2"], [2250, 2750, "Second line"]]);
      });
    }
  }
}
