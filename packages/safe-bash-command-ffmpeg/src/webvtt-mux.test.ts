import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const output of ["webm", "mkv"]) {
    for (const copy of [false, true]) {
      it(`${sync ? "sync" : "async"} ${copy ? "copies WebVTT" : "converts SubRip"} to ${output}`, async () => {
        const input = copy
          ? "WEBVTT\n\nscene-A\n00:00.250 --> 00:01.125 align:end position:80%\nFirst line\n\nscene-B\n00:01.750 --> 00:03.500 line:10%\nSecond line\n"
          : "1\n00:00:00,250 --> 00:00:01,125\nFirst line\n\n2\n00:00:01,750 --> 00:00:03,500\nSecond line\n";
        const source = copy ? "/in.vtt" : "/in.srt";
        const volume = Volume.fromJSON({ [source]: input });
        const read = (path: string) => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined;
        const write = (path: string, bytes: Uint8Array) => { volume.writeFileSync(path, bytes); return true; };
        const target = `/out.${output}`;
        const args = ["-y", "-v", "error", "-i", source, "-c:s", copy ? "copy" : "webvtt", target];
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
        const bytes = volume.readFileSync(target) as Buffer;
        assert.ok(bytes.includes(Buffer.from("D_WEBVTT/SUBTITLES")));
        assert.ok(bytes.includes(Buffer.from(copy ? "scene-A\nalign:end position:80%\nFirst line" : "\n\nFirst line")));
        assert.equal(evalSyncFfmpeg(["-i", target, "-c:s", "copy", "/roundtrip.vtt"], undefined, read, write), "");
        assert.equal(volume.readFileSync("/roundtrip.vtt", "utf8"), copy ? input :
          "WEBVTT\n\n00:00.250 --> 00:01.125\nFirst line\n\n00:01.750 --> 00:03.500\nSecond line\n");
      });
    }
  }
}
