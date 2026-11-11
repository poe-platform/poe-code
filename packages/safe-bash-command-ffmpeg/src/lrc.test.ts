import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const lrc = "[ar:Fixture Artist]\n[00:01.24]First line\n[00:03.40]Last & final\n[00:05.00]Done\n";
const srt = "1\n00:00:01,240 --> 00:00:02,800\nFirst line\ncontinuation\n\n2\n00:00:03,400 --> 00:00:05,000\nLast & final\n";
for (const sync of [false, true]) {
  for (const format of ["srt", "webvtt"]) {
    for (const single of [false, true]) {
      it(`${sync ? "sync" : "async"} LRC final cue duration in ${format}, single=${single}`, async () => {
        const volume = Volume.fromJSON({ "/in.lrc": `${single ? "" : "[00:01.00]one\n"}[00:05.00]end\n` });
        const args = ["-v", "error", "-f", "lrc", "-i", "/in.lrc", "-bitexact", "-f", format, sync ? "/out.sub" : "pipe:1"];
        let stdout = "";
        let stderr = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          stdout = volume.readFileSync("/out.sub", "utf8") as string;
        } else {
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: { async readFile(path: string) { return volume.readFileSync(path); } },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0);
        }
        assert.equal(stderr, "");
        assert.equal(stdout, format === "webvtt"
          ? `WEBVTT\n\n${single ? "" : "00:01.000 --> 00:05.000\none\n\n"}00:05.000 --> 1193:02:52.295\nend\n`
          : `${single ? "" : "1\n00:00:01,000 --> 00:00:05,000\none\n\n"}${single ? 1 : 2}\n00:00:05,000 --> 1193:02:52,295\nend\n\n`);
      });
    }
  }
}

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
          : "WEBVTT\n\n00:01.240 --> 00:03.400\nFirst line\n\n00:03.400 --> 00:05.000\nLast & final\n\n00:05.000 --> 1193:02:52.295\nDone\n");
      });
    }
  }
}
