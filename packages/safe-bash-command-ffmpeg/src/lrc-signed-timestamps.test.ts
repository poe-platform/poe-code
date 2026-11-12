import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const cases = [false, true].map(copyts => ({
  name: `negative timestamp, copyts=${copyts}`,
  copyts,
  input: "[-00:01.00]First\n[00:03.00]Two\n",
  expected: "1\n00:00:00,000 --> 00:00:04,000\nFirst\n\n2\n00:00:04,000 --> 1193:02:51,295\nTwo\n\n"
}));

for (const sync of [false, true]) {
  for (const { name, input, copyts, expected } of cases) {
    it(`matches native LRC ${name}, sync=${sync}`, async () => {
      const volume = Volume.fromJSON({ "/in.lrc": input });
      const args = ["-v", "error", "-i", "/in.lrc", ...(copyts ? ["-copyts"] : []), "-fflags", "+bitexact", "-f", "srt", sync ? "/out" : "pipe:1"];
      let stdout = "";
      let stderr = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        stdout = volume.readFileSync("/out", "utf8") as string;
      } else {
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
      }
      assert.equal(stderr, "");
      assert.equal(stdout, expected);
    });
  }
}
