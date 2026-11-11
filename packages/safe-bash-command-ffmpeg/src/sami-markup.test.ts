import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const cases = [
  ["<!--note--> text", "<!--note--> text", "<!--note--> text"],
  ["<b>bold</b> <i>italic</i> <u>underlined</u>", "<b>bold</b> <i>italic</i> <u>underlined</u>", "<b>bold</b> <i>italic</i> <u>underlined</u>"],
  ['<font color=red>Red</font>', '<font color="#ff0000">Red</font>', "Red"],
  ['<FONT COLOR="#AABBCC"><B>Café &amp; tea</B></FONT>', '<font color="#aabbcc"><b>Café &amp; tea</b></font>', '<b>Café &amp; tea</b>'],
  ['&lt;b&gt;literal&lt;/b&gt; &amp;lt;tag&amp;gt;', '&lt;b&gt;literal&lt;/b&gt; &amp;lt;tag&amp;gt;', '&lt;b&gt;literal&lt;/b&gt; &amp;lt;tag&amp;gt;']
];

for (const sync of [false, true]) {
  for (const format of ["srt", "webvtt"]) {
    for (const [input, srt, webvtt] of cases) {
      it(`${sync ? "sync" : "async"} SAMI to ${format} preserves supported markup: ${input}`, async () => {
        const volume = Volume.fromJSON({ "/in.smi": `<SAMI>\n<BODY>\n<SYNC Start=1000><P>${input}\n<SYNC Start=3000><P>done\n</BODY>\n</SAMI>\n` });
        const args = ["-v", "error", "-f", "sami", "-i", "/in.smi", "-f", format, sync ? "/out.subtitle" : "pipe:1"];
        let stdout = "";
        let stderr = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          stdout = volume.readFileSync("/out.subtitle", "utf8") as string;
        } else {
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        assert.equal(stderr, "");
        assert.equal(stdout, format === "srt"
          ? `1\n00:00:01,000 --> 00:00:03,000\n${srt}\n\n2\n00:00:03,000 --> 1193:02:50,295\ndone\n\n`
          : `WEBVTT\n\n00:01.000 --> 00:03.000\n${webvtt}\n\n00:03.000 --> 1193:02:50.295\ndone\n`);
      });
    }
  }
}
