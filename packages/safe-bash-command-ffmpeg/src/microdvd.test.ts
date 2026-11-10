import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Dialogue verified against native FFmpeg; compare complete cues as well as text.
const cues = [
  ["{y:i}First|second", "<i>First</i>\nsecond"],
  ["{Y:i}First|second", "<i>First\nsecond</i>"],
  ['{f:Arial}{s:20}{c:$0000ff}Red|second', '<font color="#ff0000"><font face="Arial"><font size="20">Red</font></font></font>\nsecond'],
  ["{y:b}First", "<b>First</b>"],
  ["First|second", "First\nsecond"],
  ["same{y:i}mid", "same{y:i}mid"],
  ["{y:biu}one|two", "<i><b><u>one</u></b></i>\ntwo"],
  ["{y:i}one|{y:b}two", "<i>one</i>\n<b>two</b>"],
  ['{F:Arial}{S:20}{C:$0000ff}Red|second', '<font color="#ff0000"><font face="Arial"><font size="20">Red\nsecond</font></font></font>']
];

for (const sync of [false, true]) for (const copy of [false, true]) {
  for (const [text, expected] of cues) {
    it(`${sync ? "sync" : "async"} ${copy ? "copies" : "decodes"} MicroDVD ${text}`, async () => {
      const input = `{1}{1}25\n{25}{50}${text}\n`;
      const output = copy ? "/out.sub" : "/out.srt";
      const volume = Volume.fromJSON({ "/input": input, [output]: "KEEP" });
      const args = ["-v", "error", "-y", "-f", "microdvd", "-i", "/input", "-c:s",
        copy ? "copy" : "srt", ...(copy ? ["-f", "microdvd"] : []), output];
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
      assert.equal(volume.readFileSync(output, "utf8"), copy ? `{25}{50}${text}\n`
        : `1\n00:00:01,000 --> 00:00:02,000\n${expected}\n\n`);
      assert.equal(volume.readFileSync("/input", "utf8"), input);
    });
  }
}
