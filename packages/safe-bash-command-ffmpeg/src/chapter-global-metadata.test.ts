import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const chapterTimes = [
  "\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=500\nEND=2200\n",
  "\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=2200\nEND=3500\n"
];
const chapterTags = ["title=First\nartist=Ann\n", "title=Second\nartist=Bob\n"];
const input = ";FFMETADATA1\ntitle=Album\nartist=Pat\n" +
  chapterTimes.map((times, index) => times + chapterTags[index]).join("");

for (const sync of [false, true]) {
  for (const { name, options, global, chapters, source = input } of [
    { name: "explicit global destination", options: ["-map_metadata:g", "0:c:1"], global: chapterTags[1], chapters: chapterTimes.join("") },
    { name: "implicit global destination", options: ["-map_metadata", "0:c:0"], global: chapterTags[0], chapters: chapterTimes.join("") },
    { name: "global source control", options: ["-map_metadata:g", "0:g"], global: "title=Album\nartist=Pat\n", chapters: chapterTimes.map((times, index) => times + chapterTags[index]).join("") },
    { name: "explicit assignments", options: ["-map_metadata", "0:c:1", "-metadata", "title=Override", "-metadata:c:0", "title=Chapter"], global: "title=Override\nartist=Bob\n", chapters: chapterTimes[0] + "title=Chapter\n" + chapterTimes[1] },
    { name: "disabled chapter output", options: ["-map_metadata", "0:c:1", "-map_chapters", "-1"], global: chapterTags[1], chapters: "" },
    { name: "custom chapter tags without a title", options: ["-map_metadata", "0:c:0"], source: ";FFMETADATA1\ntitle=Album\n" + chapterTimes[0] + "artist=Ann\ncustom_field=note\n", global: "artist=Ann\ncustom_field=note\n", chapters: chapterTimes[0] },
    { name: "second input chapter", options: ["-i", "/second.ffmeta", "-map_metadata", "1:c:1"], global: "title=Other\nartist=Bob\n", chapters: chapterTimes.join("") }
  ]) {
    it(`maps chapter tags to global metadata: ${name} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.ffmeta": source, "/second.ffmeta": input.replace("Second", "Other") });
      const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.ffmeta", ...options, "-bitexact", "-f", "ffmetadata", sync ? "/out.ffmeta" : "pipe:1"];
      let stdout = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        stdout = volume.readFileSync("/out.ffmeta", "utf8") as string;
      } else {
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
      }
      const [actual, expected] = [stdout, ";FFMETADATA1\n" + global + chapters].map(output =>
        output.split("[CHAPTER]\n").map(section => section.split("\n").filter(Boolean).sort()));
      assert.deepEqual(actual, expected);
    });
  }
}

for (const source of ["0:c:2", "0:c:-1", "0:c", "0:c:", "0:c:nope", "0:c:0:extra", "1:c:0"]) {
  it(`rejects invalid chapter metadata source ${source} without replacing output`, async () => {
    const volume = Volume.fromJSON({ "/in.ffmeta": input, "/out.ffmeta": "existing" });
    const args = ["-y", "-i", "/in.ffmeta", "-map_metadata", source, "-f", "ffmetadata", "/out.ffmeta"];
    assert.equal(evalSyncFfmpeg(args, undefined,
      path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.match(stderr, /Invalid (chapter|metadata input) index/);
    assert.equal(volume.readFileSync("/out.ffmeta", "utf8"), "existing");
  });
}
