import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const globalTags = "title=Album\nartist=Pat\n";
const chapters = [
  { start: 500, end: 2200, tags: "title=First\nartist=Ann\n" },
  { start: 2200, end: 3500, tags: "title=Second\nartist=Bob\n" }
];
const input = ";FFMETADATA1\n" + globalTags + chapters.map(chapter =>
  `\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=${chapter.start}\nEND=${chapter.end}\n${chapter.tags}`).join("");

for (const sync of [false, true]) {
  for (const test of [
    { name: "negative mapping", options: ["-map_metadata", "-1"], global: false, tags: false },
    { name: "other negative input", options: ["-map_metadata", "-2"], global: false, tags: false },
    { name: "explicit chapter source", options: ["-map_metadata", "-1", "-map_chapters", "0"], global: false, tags: false },
    { name: "positive mapping", options: ["-map_metadata", "0"], global: true, tags: true },
    { name: "automatic mapping", options: [], global: true, tags: true },
    { name: "disabled chapters", options: ["-map_chapters", "-1"], global: true, tags: true, noChapters: true },
    { name: "global-only negative mapping", options: ["-map_metadata:g", "-1"], global: false, tags: true },
    { name: "positive then negative mapping", options: ["-map_metadata", "0", "-map_metadata", "-1"], global: true, tags: false },
    { name: "negative then positive mapping", options: ["-map_metadata", "-1", "-map_metadata", "0"], global: true, tags: false }
  ]) {
    it(`preserves chapter boundaries with ${test.name} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.meta": input });
      const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.meta", ...test.options,
        "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
      let output = "";
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, "");
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
      assert.equal(output, ";FFMETADATA1\n" + (test.global ? globalTags : "") + (test.noChapters ? "" :
        chapters.map(chapter => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${chapter.start}\nEND=${chapter.end}\n${test.tags ? chapter.tags : ""}`).join("")));
      assert.equal(volume.readFileSync("/in.meta", "utf8"), input);
    });
  }
}
