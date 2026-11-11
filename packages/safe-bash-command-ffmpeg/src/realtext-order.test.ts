import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const alpha = '<time begin="1" end="2"><clear/>Alpha';
const beta = '<time begin="5" end="6"><clear/>Beta';
const expected = "1\n00:00:01,000 --> 00:00:02,000\nAlpha\n\n2\n00:00:05,000 --> 00:00:06,000\nBeta\n\n";

for (const reversed of [false, true]) {
  for (const sync of [false, true]) {
    for (const forced of [false, true]) {
      it(`${sync ? "sync" : "async"} ${forced ? "forced" : "detected"} RealText numbers ${reversed ? "reversed" : "sorted"} cues chronologically`, async () => {
        const input = `<window>${reversed ? beta + alpha : alpha + beta}</window>`;
        const volume = Volume.fromJSON({ "/input.rt": input });
        const args = ["-v", "error", ...(forced ? ["-f", "realtext"] : []), "-i", "/input.rt", "-f", "srt", sync ? "/out.srt" : "pipe:1"];
        let stdout = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, data) => { volume.writeFileSync(path, data); return true; }), "");
          stdout = volume.readFileSync("/out.srt", "utf8").toString();
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
        assert.equal(stdout, expected);
        assert.equal(volume.readFileSync("/input.rt", "utf8"), input);
      });
    }
  }
}
