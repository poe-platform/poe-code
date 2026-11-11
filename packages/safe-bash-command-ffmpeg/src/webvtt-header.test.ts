import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const header of ["badhead", " WEBVTT", "WEBVTT", "\uFEFFWEBVTT", "WEBVTTjunk"]) {
    it(`${sync ? "sync" : "async"} converts WebVTT header ${JSON.stringify(header)} like native FFmpeg`, async () => {
      const volume = Volume.fromJSON({ "/in.vtt": `${header}\n\nname-1\n00:01.250 --> 00:03.500 align:start position:15%\nOne\nTwo\n\nname-2\n00:05.000 --> 00:06.750\nThree\n` });
      const args = ["-y", "-v", "error", "-i", "/in.vtt", "/out.srt"];
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
        header === "badhead" || header === " WEBVTT" ? "" :
          "1\n00:00:01,250 --> 00:00:03,500\nOne\r\nTwo\n\n2\n00:00:05,000 --> 00:00:06,750\nThree\n\n");
    });
  }
}
