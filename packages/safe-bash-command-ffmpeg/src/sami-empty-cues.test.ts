import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const input of ["<P></P>", "<P>  ", "text without P", "<P>&nbsp;"]) {
    it(`${sync ? "sync" : "async"} SAMI preserves native WebVTT intervals for ${JSON.stringify(input)}`, async () => {
      const volume = Volume.fromJSON({ "/in.smi":
        `<SAMI>\n<BODY>\n<SYNC Start=1000>${input}\n<SYNC Start=3000><P>done\n</BODY>\n</SAMI>\n` });
      const args = ["-v", "error", "-f", "sami", "-i", "/in.smi", "-f", "webvtt", sync ? "/out.vtt" : "pipe:1"];
      let stdout = "";
      let stderr = "";
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        if (input === "<P>&nbsp;") {
          assert.equal(result, undefined);
          assert.equal(volume.existsSync("/out.vtt"), false);
          return;
        }
        assert.equal(result, "");
        stdout = volume.readFileSync("/out.vtt", "utf8") as string;
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
      assert.equal(stderr, input === "<P>&nbsp;"
        ? "ffmpeg: Error decoding subtitles: Operation not permitted\n" : "");
      assert.equal(stdout, "WEBVTT\n\n"
        + (input === "<P>&nbsp;" ? "" : "00:01.000 --> 00:03.000\n\n\n")
        + "00:03.000 --> 1193:02:50.295\ndone\n");
    });
  }
}
