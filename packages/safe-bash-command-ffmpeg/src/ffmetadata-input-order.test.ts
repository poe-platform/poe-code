import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [name, tags, expectedTags] of [
  ["first key", "a=1\nb=2\nc=3\na=4", "c=3\nb=2\na=4"],
  ["case-insensitive key", "a=1\nb=2\nc=3\nA=4", "c=3\nb=2\nA=4"],
  ["middle key", "a=1\nb=2\nc=3\nd=4\nb=5", "a=1\nd=4\nc=3\nb=5"],
  ["last key", "a=1\nb=2\nc=3\nc=4", "a=1\nb=2\nc=4"],
  ["multiple replacements", "a=1\nb=2\nc=3\na=4\nc=5", "a=4\nb=2\nc=5"],
  ["recognized key", "title=1\nb=2\nc=3\nTITLE=4", "c=3\nb=2\nTITLE=4"],
  ["empty replacement", "a=1\nb=2\nc=3\na=", "c=3\nb=2\na="],
  ["unique control", "a=1\nb=2\nc=3", "a=1\nb=2\nc=3"]
]) {
    it(`exports repeated FFmetadata input keys: ${name} (${sync ? "sync" : "async"})`, async () => {
      const header = "[CHAPTER]\nTIMEBASE=1/10\nSTART=10\nEND=20\n";
      const input = `;FFMETADATA1\n${tags}\n${header}${tags}\n`;
      const expected = `;FFMETADATA1\n${expectedTags}\n${header}${expectedTags}\n`;
      const volume = Volume.fromJSON({ "/in.meta": input });
      const args = ["-v", "error", "-f", "ffmetadata", "-i", "/in.meta", "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
      if (sync) {
        args.unshift("-y");
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        assert.equal(volume.readFileSync("/out.meta", "utf8"), expected);
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
        assert.equal(stdout, expected);
      }
    });
  }
}
