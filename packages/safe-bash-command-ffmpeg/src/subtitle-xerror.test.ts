import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const strict of [false, true]) {
  for (const precedingCue of [false, true]) {
    it(`SubRip decode error ${strict ? "stops" : "recovers"} with preceding cue=${precedingCue}`, async () => {
      // FFmpeg 7.0.2: -xerror returns 183 and writes only cues before the error.
      const input = Buffer.concat([
        Buffer.from(precedingCue ? "0\n00:00:00,000 --> 00:00:00,500\nBefore\n\n" : ""),
        Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n"),
        Buffer.from([67, 97, 102, 0xe9, 32, 0x80]),
        Buffer.from("\n\n2\n00:00:03,000 --> 00:00:04,000\nValid\n\n")
      ]);
      const volume = Volume.fromJSON({ "/mixedstop.srt": input, "/out.vtt": "KEEP" });
      const args = ["-v", "error", "-y", ...(strict ? ["-xerror"] : []), "-i", "/mixedstop.srt", "/out.vtt"];
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
      assert.equal(volume.readFileSync("/out.vtt", "utf8"), "KEEP");
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
      assert.equal(result.exitCode, strict ? 183 : 0, stderr);
      assert.match(stderr, /Invalid UTF-8 in decoded subtitles text/);
      assert.equal(volume.readFileSync("/out.vtt", "utf8"), "WEBVTT\n"
        + (precedingCue ? "\n00:00.000 --> 00:00.500\nBefore\n" : "")
        + (strict ? "" : "\n00:03.000 --> 00:04.000\nValid\n"));
    });
  }
}
