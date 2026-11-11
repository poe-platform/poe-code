import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [text, srt, webvtt] of [
  ["A<br/>B", "A\r\nB", "A\nB"],
  ["AB", "AB", "AB"]
] as const) {
  for (const format of ["srt", "webvtt"]) {
    for (const sync of [false, true]) {
      for (const forced of [false, true]) {
        it(`${sync ? "sync" : "async"} ${forced ? "forced" : "detected"} RealText to ${format} uses exact line endings for ${text}`, async () => {
          const input = `<window><time begin="1" end="2"><clear/>${text}</window>`;
          const volume = Volume.fromJSON({ "/input.rt": input });
          const output = `/out.${format}`;
          const args = ["-v", "error", ...(forced ? ["-f", "realtext"] : []), "-i", "/input.rt",
            "-f", format, sync ? output : "pipe:1"];
          let stdout = "";
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined,
              path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
              (path, data) => { volume.writeFileSync(path, data); return true; }), "");
            stdout = volume.readFileSync(output, "utf8").toString();
          } else {
            let stderr = "";
            const result = await createFfmpegCommand().execute({
              args, cwd: "/", env: {}, signal: new AbortController().signal,
              fs: {
                async readFile(path: string) { return volume.readFileSync(path); },
                async stat(path: string) { return volume.statSync(path); }
              },
              stdin: (async function* () {})(),
              stdout: { async write(data: Uint8Array) { stdout += new TextDecoder().decode(data); } },
              stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
            } as never);
            assert.equal(result.exitCode, 0, stderr);
            assert.equal(stderr, "");
          }
          assert.equal(stdout, format === "srt"
            ? `1\n00:00:01,000 --> 00:00:02,000\n${srt}\n\n`
            : `WEBVTT\n\n00:01.000 --> 00:02.000\n${webvtt}\n`);
          assert.equal(volume.readFileSync("/input.rt", "utf8"), input);
        });
      }
    }
  }
}
