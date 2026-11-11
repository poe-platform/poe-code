import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const chapterTags = "TIMEBASE=1/10\nSTART=10\nEND=20\ntitle=One\n";
for (const sync of [false, true]) {
  for (const [marker, tags, expected] of [
    [" [CHAPTER]", chapterTags, chapterTags],
    ["[CHAPTER] suffix", chapterTags, `[CHAPTER]\n${chapterTags}`],
    [" [STREAM]", "foo=1\n", "foo=1\n"],
    ["[STREAM] suffix", "foo=1\n", ""],
    ["[CHAPTER]", chapterTags, `[CHAPTER]\n${chapterTags}`],
    ["[STREAM]", "foo=1\n", ""]
  ]) {
    it(`exports FFmetadata with marker ${JSON.stringify(marker)} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.meta": `;FFMETADATA1\n${marker}\n${tags}` });
      const args = ["-v", "error", "-f", "ffmetadata", "-i", "/in.meta", "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
      const output = `;FFMETADATA1\n${expected}`;
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
