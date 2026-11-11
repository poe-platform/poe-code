import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [input, expected] of [
    [" #note=one\n ;note=two", " \\#note=one\n \\;note=two"],
    ["\t#note=one\n\t;note=two", "\t\\#note=one\n\t\\;note=two"],
    ["#note=one\n;note=two\nplain=value", "plain=value"]
  ]) {
    it(`preserves whitespace before FFmetadata comment markers: ${input} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.meta": `;FFMETADATA1\n${input}\n` });
      const args = ["-v", "error", "-f", "ffmetadata", "-i", "/in.meta", "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
      const output = `;FFMETADATA1\n${expected}\n`;
      if (sync) {
        args.unshift("-y");
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        assert.equal(volume.readFileSync("/out.meta", "utf8"), output);
      } else {
        let stdout = "";
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
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        assert.equal(stdout, output);
      }
    });
  }
}
