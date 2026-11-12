import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const copy of [false, true]) {
    it(`${sync ? "sync" : "async"} ${copy ? "copies" : "transcodes"} SubRip HTML breaks to LRC`, async () => {
      const volume = Volume.fromJSON({
        "/in.br.srt": "1\n00:00:01,235 --> 00:00:02,500\nA<br>B\n\n2\n00:00:03,000 --> 00:00:04,000\nLast\n"
      });
      const args = ["-v", "error", "-i", "/in.br.srt", "-fflags", "+bitexact",
        ...(copy ? ["-c:s", "copy"] : []), "-f", "lrc", sync ? "/out.lrc" : "pipe:1"];
      let output = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        output = volume.readFileSync("/out.lrc", "utf8").toString();
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
      }
      assert.equal(output, copy
        ? "\n[00:01.24]A<br>B\n[00:03.00]Last\n"
        : "\n[00:01.24]A\n[00:01.24]B\n[00:03.00]Last\n");
    });
  }
}
