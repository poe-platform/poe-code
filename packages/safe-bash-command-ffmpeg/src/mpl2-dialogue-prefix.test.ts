import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const format of ["webvtt", "srt"]) {
    for (const [dialogue, expected] of [
      [" /Alpha", "<i>Alpha</i>"],
      ["  /Alpha", "/Alpha"],
      ["  Alpha", "Alpha"],
      ["A| /B", "A\n /B"],
      ["/Alpha", "<i>Alpha</i>"],
      [" /Alpha| /Beta|/Gamma", "<i>Alpha</i>\n /Beta\n<i>Gamma</i>"],
      [" / Alpha", "<i> Alpha</i>"],
      ["Alpha  Beta", "Alpha  Beta"],
      ["\t/Alpha", "\t/Alpha"],
      ["\u00a0/Alpha", "\u00a0/Alpha"]
    ]) {
      it(`${sync ? "sync" : "async"} MPL2 dialogue prefix to ${format}: ${JSON.stringify(dialogue)}`, async () => {
        const volume = Volume.fromJSON({ "/input.txt": `[10][20]${dialogue}\n` });
        const args = ["-v", "error", "-f", "mpl2", "-i", "/input.txt", "-f", format, sync ? "/output" : "pipe:1"];
        let stdout = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          stdout = volume.readFileSync("/output", "utf8").toString();
        } else {
          let stderr = "";
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
          assert.equal(result.exitCode, 0);
          assert.equal(stderr, "");
        }
        assert.equal(stdout.replaceAll("\r\n", "\n"), format === "webvtt"
          ? `WEBVTT\n\n00:01.000 --> 00:02.000\n${expected}\n`
          : `1\n00:00:01,000 --> 00:00:02,000\n${expected}\n\n`);
      });
    }
  }
}
