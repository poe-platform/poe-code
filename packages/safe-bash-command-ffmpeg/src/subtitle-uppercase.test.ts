import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [input, output, copy, text, expected] of [
    ["srt", "vtt", false, "<B>LOUD</B> <I>soft</I>", "<b>LOUD</b> <i>soft</i>"],
    ["srt", "vtt", false, "<b>LOUD</b> <i>soft</i>", "<b>LOUD</b> <i>soft</i>"],
    ["srt", "vtt", false, "<B><i>Mixed</I></b> <U>line</u>", "<b><i>Mixed</i></b> <u>line</u>"],
    ["srt", "srt", true, "<B>LOUD</B> <I>soft</I>", "<B>LOUD</B> <I>soft</I>"],
    ["vtt", "vtt", false, "<B>LOUD</B> <I>soft</I> <u>line</u>", "LOUD soft <u>line</u>"]
  ] as const) {
    it(`${sync ? "sync" : "async"} ${input} -> ${output} emphasis: ${text}, copy=${copy}`, async () => {
      const source = input === "srt"
        ? `1\n00:00:00,000 --> 00:00:01,000\n${text}\n`
        : `WEBVTT\n\n00:00.000 --> 00:01.000\n${text}\n`;
      const volume = Volume.fromJSON({ [`/in.${input}`]: source });
      const args = ["-v", "error", "-y", "-i", `/in.${input}`,
        ...(copy ? ["-c:s", "copy"] : []), `/out.${output}`];
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
      assert.equal(volume.readFileSync(`/out.${output}`, "utf8"), output === "srt"
        ? `1\n00:00:00,000 --> 00:00:01,000\n${expected}\n\n`
        : `WEBVTT\n\n00:00.000 --> 00:01.000\n${expected}\n`);
      assert.equal(volume.readFileSync(`/in.${input}`, "utf8"), source);
    });
  }
}
