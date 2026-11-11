import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [name, global, chapter, expectedGlobal, expectedChapter] of [
    ["lowercase replacement", "title=Album", "Title=first\ntitle=second", "title=Album", "title=second"],
    ["uppercase replacement", "title=Album", "title=first\nTITLE=second", "title=Album", "TITLE=second"],
    ["global control", "title=first\nTITLE=second", "title=Intro", "TITLE=second", "title=Intro"],
    ["single key control", "title=Album", "title=second", "title=Album", "title=second"]
  ]) {
    it(`imports FFmetadata chapter keys: ${name} (${sync ? "sync" : "async"})`, async () => {
      const header = "[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=3000\n";
      const suffix = "artist=Ada\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=3000\nEND=8000\ntitle=Body\ngenre=Talk\n";
      const input = `;FFMETADATA1\n${global}\n${header}${chapter}\n${suffix}`;
      const expected = `;FFMETADATA1\n${expectedGlobal}\n${header}${expectedChapter}\n${suffix}`;
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
