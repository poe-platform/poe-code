import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const test of [
    { name: "reported tags", chapter: "title=One\ncomment=note\n", global: "artist=Two\n",
      chapterFirst: "title=One\ncomment=note\nartist=Two\n", globalFirst: "artist=Two\ntitle=One\ncomment=note\n" },
    { name: "custom tags interleaved with known tags", chapter: "comment=note\nx-chapter=first\ntitle=One\n", global: "artist=Two\nx-global=second\nalbum=Album\n",
      chapterFirst: "comment=note\nx-chapter=first\ntitle=One\nartist=Two\nx-global=second\nalbum=Album\n",
      globalFirst: "artist=Two\nx-global=second\nalbum=Album\ncomment=note\nx-chapter=first\ntitle=One\n" },
    { name: "first mapped value wins", chapter: "title=One\ncomment=note\n", global: "artist=Two\ntitle=Other\n",
      chapterFirst: "title=One\ncomment=note\nartist=Two\n", globalFirst: "artist=Two\ntitle=Other\ncomment=note\n" }
  ]) {
    for (const chapterFirst of [true, false]) {
      it(`keeps chapter/global map order for ${test.name}, chapter first=${chapterFirst} (${sync ? "sync" : "async"})`, async () => {
        const first = `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1\nSTART=1\nEND=2\n${test.chapter}`;
        const second = `;FFMETADATA1\n${test.global}`;
        const volume = Volume.fromJSON({ "/a.meta": first, "/b.meta": second });
        const sources = chapterFirst ? ["0:c:0", "1:g"] : ["1:g", "0:c:0"];
        const args = ["-v", "error", "-i", "/a.meta", "-i", "/b.meta", "-map_chapters", "-1",
          ...sources.flatMap(source => ["-map_metadata", source]), "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
        let output = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
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
          assert.equal(stderr, "");
        }
        assert.equal(output, `;FFMETADATA1\n${chapterFirst ? test.chapterFirst : test.globalFirst}`);
        assert.equal(volume.readFileSync("/a.meta", "utf8"), first);
        assert.equal(volume.readFileSync("/b.meta", "utf8"), second);
      });
    }
  }
}
