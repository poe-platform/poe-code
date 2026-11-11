import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Dialogue verified against native FFmpeg; compare complete cues as well as text.
const cues = [
  ["A", "A"],
  ["A|B", "A\nB"],
  ["|A", "\nA"],
  ["A|", "A\n"],
  ["A||B", "A\n\nB"],
  ["{H:1250}Hello", "Hello"],
  ["{H:bad}Hello", "Hello"],
  ["{H:}Hello", "Hello"],
  ["{h:1250}Hello", "{h:1250}Hello"],
  ["Hello{H:1250}world", "Hello{H:1250}world"],
  ["Hello|{H:1250}world", "Hello\nworld"],
  ["{H:1250}{y:i}Hello", "<i>Hello</i>"],
  ["{y:i}First|second", "<i>First</i>\nsecond"],
  ["{Y:i}First|second", "<i>First\nsecond</i>"],
  ["{Y:i}a|{y:b}b|c", "<i>a\n<b>b</b>\nc</i>"],
  ["{Y:i}a|b|c", "<i>a\nb\nc</i>"],
  ["{Y:i}{y:b}a|b|c", "<i><b>a</b>\nb\nc</i>"],
  ["{y:b}{Y:i}a|b|c", "<i><b>a</b>\nb\nc</i>"],
  ["{Y:i}a|{y:b}b|{y:u}c|d", "<i>a\n<b>b</b>\n<u>c</u>\nd</i>"],
  ['{f:Arial}{s:20}{c:$0000ff}Red|second', '<font color="#ff0000"><font face="Arial"><font size="20">Red</font></font></font>\nsecond'],
  ["{y:b}First", "<b>First</b>"],
  ["First|second", "First\nsecond"],
  ["same{y:i}mid", "same{y:i}mid"],
  ["{y:biu}one|two", "<i><b><u>one</u></b></i>\ntwo"],
  ["{y:i}one|{y:b}two", "<i>one</i>\n<b>two</b>"],
  ['{F:Arial}{S:20}{C:$0000ff}Red|second', '<font color="#ff0000"><font face="Arial"><font size="20">Red\nsecond</font></font></font>']
];

for (const sync of [false, true]) for (const format of ["microdvd", "srt", "webvtt"]) for (const pipe of sync ? [false] : [false, true]) {
  const copy = format === "microdvd";
  for (const [text, expected] of cues) {
    it(`${sync ? "sync" : "async"} ${format} ${pipe ? "stdout" : "file"} MicroDVD ${text}`, async () => {
      const input = `{1}{1}25\n{25}{50}${text}\n`;
      const output = copy ? "/out.sub" : format === "srt" ? "/out.srt" : "/out.vtt";
      const volume = Volume.fromJSON({ "/input": input, [output]: "KEEP" });
      const args = ["-v", "error", "-y", "-f", "microdvd", "-i", "/input", "-c:s",
        copy ? "copy" : format, "-f", format, pipe ? "pipe:1" : output];
      let stdout = "";
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
          stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
      }
      if (!pipe) assert.equal(stdout, "");
      assert.equal(pipe ? stdout : volume.readFileSync(output, "utf8"), copy ? `{25}{50}${text}\n`
        : format === "webvtt" ? `WEBVTT\n\n00:01.000 --> 00:02.000\n${expected}\n`
        : `1\n00:00:01,000 --> 00:00:02,000\n${expected!.replaceAll("\n", "\r\n")}\n\n`);
      assert.equal(volume.readFileSync("/input", "utf8"), input);
    });
  }
}
