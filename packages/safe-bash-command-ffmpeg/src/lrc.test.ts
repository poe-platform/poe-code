import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const lrc = "[ar:Fixture Artist]\n[00:01.24]First line\n[00:03.40]Last & final\n[00:05.00]Done\n";
const srt = "1\n00:00:01,240 --> 00:00:02,800\nFirst line\ncontinuation\n\n2\n00:00:03,400 --> 00:00:05,000\nLast & final\n";
for (const sync of [false, true]) {
  for (const forced of [false, true]) {
    for (const output of [false, true]) {
      it(`${sync ? "sync" : "async"} LRC ${output ? "output" : "input"}, forced=${forced}`, async () => {
        const volume = Volume.fromJSON({ "/in.lrc": lrc, "/in.srt": srt });
        const target = output ? "/out.lrc" : "/out.vtt";
        const args = ["-y", "-v", "error", ...(!output && forced ? ["-f", "lrc"] : []),
          "-i", output ? "/in.srt" : "/in.lrc", ...(output && forced ? ["-f", "lrc"] : []), target];
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
        assert.equal(volume.readFileSync(target, "utf8"), output
          ? "[re:Lavf61.7.100]\n[ve:61.7.100]\n\n[00:01.24]First line\n[00:01.24]continuation\n[00:03.40]Last & final\n"
          : "WEBVTT\n\n00:01.240 --> 00:03.400\nFirst line\n\n00:03.400 --> 00:05.000\nLast & final\n\n00:05.000 --> 00:05.000\nDone\n");
      });
    }
  }
}
