import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [begin, end, interval] of [
  ["0:01.2", "0:02.3", "00:01.020 --> 00:02.030"],
  ["1.234", "2.789", "00:03.340 --> 00:09.890"],
  ["1.25", "2.75", "00:01.250 --> 00:02.750"]
]) {
  for (const sync of [false, true]) {
    for (const forced of [false, true]) {
      it(`${sync ? "sync" : "async"} ${forced ? "forced" : "detected"} RealText ${begin} to ${end} preserves centisecond timing`, async () => {
        const input = `<window><time begin="${begin}" end="${end}"><clear/>Alpha</window>`;
        const volume = Volume.fromJSON({ "/input.rt": input });
        const args = ["-v", "error", ...(forced ? ["-f", "realtext"] : []), "-i", "/input.rt",
          "-f", "webvtt", sync ? "/out.vtt" : "pipe:1"];
        let stdout = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, data) => { volume.writeFileSync(path, data); return true; }), "");
          stdout = volume.readFileSync("/out.vtt", "utf8").toString();
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
        assert.equal(stdout, `WEBVTT\n\n${interval}\nAlpha\n`);
        assert.equal(volume.readFileSync("/input.rt", "utf8"), input);
      });
    }
  }
}
