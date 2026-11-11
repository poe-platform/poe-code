import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const format of ["sami", "auto", "srt"]) {
    it(`${sync ? "sync" : "async"} ${format} input preserves subtitle timing and lines`, async () => {
      const volume = Volume.fromJSON({ "/input.smi": format !== "srt"
        ? "<SAMI>\n<BODY>\n<SYNC Start=1240><P>First line<br>continuation\n<SYNC Start=3400><P>Last caption\n</BODY></SAMI>\n"
        : "1\n00:00:01,200 --> 00:00:02,800\nFirst line\ncontinuation\n\n2\n00:00:03,400 --> 00:00:05,000\nLast & final\n" });
      const target = "/out.vtt";
      const args = ["-v", "error", "-y", ...(format === "auto" ? [] : ["-f", format]), "-i", "/input.smi", target];
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
      assert.equal(volume.readFileSync(target, "utf8"),
        format !== "srt"
          ? "WEBVTT\n\n00:01.240 --> 00:03.400\nFirst line\ncontinuation\n\n00:03.400 --> 1193:02:50.695\nLast caption\n"
          : "WEBVTT\n\n00:01.200 --> 00:02.800\nFirst line\ncontinuation\n\n00:03.400 --> 00:05.000\nLast & final\n");
    });
  }
}

for (const [paragraphs, caption] of [
  ['<P Class=EN>Hello</P><P Class=PL>Cześć</P>', 'Hello\nCześć'],
  ['<P>one</P><P>two</P>', 'one\ntwo'],
  ['<P>one\n<P>two', 'one\ntwo'],
  ['<P>one\ntwo', 'one two']
]) {
  for (const format of ["srt", "webvtt"]) {
    it(`converts SAMI paragraphs to ${format} lines in one timed cue: ${paragraphs}`, async () => {
      const volume = Volume.fromJSON({ "/in.smi": `<SAMI>\n<BODY>\n<SYNC Start=1000>${paragraphs}\n<SYNC Start=3000><P>done\n</BODY>\n</SAMI>\n` });
      let stdout = "";
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "sami", "-i", "in.smi", "-f", format, "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0);
      assert.equal(stderr, "");
      assert.equal(stdout, format === "srt"
        ? `1\n00:00:01,000 --> 00:00:03,000\n${caption!.split("\n").join("\r\n")}\n\n2\n00:00:03,000 --> 1193:02:50,295\ndone\n\n`
        : `WEBVTT\n\n00:01.000 --> 00:03.000\n${caption}\n\n00:03.000 --> 1193:02:50.295\ndone\n`);
    });
  }
}
