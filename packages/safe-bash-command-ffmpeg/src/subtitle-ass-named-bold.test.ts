import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const style of ["Speaker", "Default"]) {
  for (const sync of [false, true]) {
    it(`applies named ASS bold style ${style} to SubRip (sync=${sync})`, async () => {
      const input = `[Script Info]
ScriptType: v4.00+
PlayResX: 384
PlayResY: 288

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ${style},Arial,16,&Hffffff,&Hffffff,&H0,&H0,-1,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1
Style: Plain,Arial,16,&Hffffff,&Hffffff,&H0,&H0,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,${style},,0,0,0,,Named
Dialogue: 0,0:00:02.00,0:00:03.00,Plain,,0,0,0,,Plain
Dialogue: 0,0:00:03.00,0:00:04.00,${style},,0,0,0,,` + String.raw`Bold{\b0}Plain{\b1}Bold{\r}Reset` + "\n";
      const volume = Volume.fromJSON({ "/in.ass": input });
      const args = ["-y", "-v", "error", "-i", "/in.ass", "/out.srt"];
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
      // Matches native FFmpeg 7.0.2, including inline bold cancellation and reset.
      assert.equal(volume.readFileSync("/out.srt", "utf8"),
        "1\n00:00:01,000 --> 00:00:02,000\n<b>Named</b>\n\n" +
        "2\n00:00:02,000 --> 00:00:03,000\nPlain\n\n" +
        "3\n00:00:03,000 --> 00:00:04,000\n<b>Bold</b>Plain<b>Bold</b>Reset\n\n");
      assert.equal(volume.readFileSync("/in.ass", "utf8"), input);
    });
  }
}
