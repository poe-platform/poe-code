import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const first = "1\n00:00:01,000 --> 00:00:02,000\nA\n\n";
const second = "1\n00:00:03,000 --> 00:00:04,000\nB\n\n";
const input = first + "2\n00:00:03,000 --> 00:00:04,000\nB\n";

for (const sync of [false, true]) {
  for (const copy of [false, true]) {
    for (const [chain, expected] of [
      ["noise=drop=eq(n\\,1)", first],
      ["noise=drop=eq(n\\,0)", second],
      ["noise=drop='eq(n,1)'", first],
      ["null,noise=drop=eq(n\\,0),null", second],
      ["noise=drop=eq(n\\,0),noise=drop=eq(n\\,0)", ""],
      ["noise=drop=0", input + "\n"],
      ["noise=drop=1", ""],
      ["null", input + "\n"]
    ] as const) {
      it(`subtitle ${chain} preserves retained cues (sync=${sync}, copy=${copy})`, async () => {
        const volume = Volume.fromJSON({ "/in.srt": input });
        const args = ["-v", "error", "-i", "/in.srt", ...(copy ? ["-c:s", "copy"] : []),
          "-bsf:s", chain, "-f", "srt", sync ? "/out.srt" : "pipe:1"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          assert.equal(volume.readFileSync("/out.srt", "utf8"), expected);
        } else {
          let stdout = "", stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
          assert.equal(stdout, expected);
        }
      });
    }
  }
}
