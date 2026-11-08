import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const timing of ["oops --> wrong", "00:01,200 --> 00:02,300", "1.200 --> 2.300"]) {
  for (const preceding of ["", "00:01.000 --> 00:02.000\nHello\n\n"]) {
    it(`copies only WebVTT cues before ${timing}, preceding cue=${Boolean(preceding)}`, async () => {
      const volume = Volume.fromJSON({
        "/in.vtt": `WEBVTT\n\n${preceding}${timing}\nBad\n\n00:03.000 --> 00:04.000\nGood\n`
      });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.vtt", "-map", "0:s:0", "-c:s", "copy", "/out.vtt"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(volume.readFileSync("/out.vtt", "utf8"),
        preceding ? `WEBVTT\n\n${preceding.trimEnd()}\n` : "WEBVTT\n");
    });
  }
}
