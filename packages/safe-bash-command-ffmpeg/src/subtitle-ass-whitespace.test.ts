import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 640
PlayResY: 360

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Callout,Courier New,16,&Hffffff,&Hffffff,&H0,&H0,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
const cases = [["  leading and trailing  ", "leading and trailing  "]];
const dialogue = cases.map(([input], index) =>
  `Dialogue: 3,0:00:${String(index * 3 + 1).padStart(2, "0")}.00,0:00:${String(index * 3 + 3).padStart(2, "0")}.00,Callout,Actor,0010,0020,0030,,${input}\n`).join("");

for (const sync of [false, true]) {
  it(`preserves ASS trailing spaces and removes leading spaces in SubRip (sync=${sync})`, async () => {
    const volume = Volume.fromJSON({ "/in.ass": header + dialogue });
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
    }
    assert.equal(volume.readFileSync("/out.srt", "utf8"),
      cases.map(([, expected], index) =>
        `${index + 1}\n00:00:${String(index * 3 + 1).padStart(2, "0")},000 --> 00:00:${String(index * 3 + 3).padStart(2, "0")},000\n${expected}\n\n`).join(""));
  });
}
