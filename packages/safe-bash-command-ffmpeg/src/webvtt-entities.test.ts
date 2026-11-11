import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Expected cue text verified with native FFmpeg 7.0.2.
const cases = [
  ["A &amp; B &lt; C &gt; D, &amp;lt;", "A & B < C > D, &lt;"],
  ["A&nbsp;B &lrm;L&rlm;R", "A\\hB LR"],
  ["&quot; &apos; &#38; &#x26; &AMP; &amp &bogus;", "&quot; &apos; &#38; &#x26; &AMP; &amp &bogus;"],
  ["&amp;amp; &amp;nbsp; &amp;lrm; &amp;rlm; &lt;b&gt;literal&lt;/b&gt;", "&amp; &nbsp; &lrm; &rlm; <b>literal</b>"],
  ["Plain 世界\nNext line", "Plain 世界\nNext line"],
  ["<i>&amp;</i> &am<c>p;", "<i>&</i> &amp;"]
] as const;

for (const sync of [false, true]) {
  for (const output of ["srt", "vtt", "mkv", "copy"] as const) {
    for (const [text, decoded] of cases) {
      it(`${sync ? "sync" : "async"} WebVTT references to ${output}: ${text}`, async () => {
        const input = `WEBVTT\n\n00:00.000 --> 00:01.000\n${text}\n`;
        const volume = Volume.fromJSON({ "/in.vtt": input });
        const read = (path: string) => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined;
        const write = (path: string, bytes: Uint8Array) => { volume.writeFileSync(path, bytes); return true; };
        const target = `/out.${output === "copy" ? "vtt" : output}`;
        const args = ["-v", "error", "-y", "-i", "/in.vtt",
          ...(output === "copy" ? ["-c:s", "copy"] : output === "mkv" ? ["-c:s", "ass"] : []), target];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, read, write), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { write(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        if (output === "mkv") {
          // Inspect the encoded ASS packet, including literal escaped tags.
          const cue = text === "<i>&amp;</i> &am<c>p;" ? "{\\i1}&{\\i0} &amp;" : decoded;
          assert.ok((volume.readFileSync(target) as Buffer).includes(
            Buffer.from(`0,0,Default,,0,0,0,,${cue.replaceAll("\n", "\\N")}`)));
        } else {
          assert.equal(volume.readFileSync(target, "utf8"), output === "copy" ? input : output === "srt"
            ? `1\n00:00:00,000 --> 00:00:01,000\n${decoded.replaceAll("\n", "\r\n")}\n\n`
            : `WEBVTT\n\n00:00.000 --> 00:01.000\n${decoded}\n`);
        }
      });
    }
  }
}
