import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const header = ";FFMETADATA1\ntitle=Album\nartist=Pat\n";
const chapters = [
  "[CHAPTER]\nTIMEBASE=1/1000\nSTART=500\nEND=2200\ntitle=First\nartist=Ann\n",
  "[CHAPTER]\nTIMEBASE=1/1000\nSTART=2200\nEND=3500\ntitle=Second\nartist=Bob\n"
];

for (const sync of [false, true]) {
  for (const count of [0, 1, 2]) {
    for (const omitChapters of [false, true]) {
      it(`writes FFmetadata without blank chapter separators (${count} chapters, omit=${omitChapters}, ${sync ? "sync" : "async"})`, async () => {
        const selected = chapters.slice(0, count);
        const input = header + selected.map(chapter => `\n${chapter}`).join("");
        const volume = Volume.fromJSON({ "/in.meta": input });
        const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.meta",
          ...(omitChapters ? ["-map_chapters", "-1"] : []), "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
        let output = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          output = volume.readFileSync("/out.meta", "utf8") as string;
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        assert.equal(output, header + (omitChapters ? "" : selected.join("")));
        assert.equal(volume.readFileSync("/in.meta", "utf8"), input);
      });
    }
  }
}
