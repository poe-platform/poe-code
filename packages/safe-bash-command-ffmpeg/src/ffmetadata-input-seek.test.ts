import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = ";FFMETADATA1\ntitle=Album\nartist=Pat\n\n" +
  "[CHAPTER]\nTIMEBASE=1/1000\nSTART=500\nEND=2200\ntitle=First\nartist=Ann\n\n" +
  "[CHAPTER]\nTIMEBASE=1/1000\nSTART=2200\nEND=3500\ntitle=Second\nartist=Bob\n";
const first = { TIMEBASE: "1/1000", START: "500", END: "2200", title: "First", artist: "Ann" };
const second = { TIMEBASE: "1/1000", START: "2200", END: "3500", title: "Second", artist: "Bob" };

for (const sync of [false, true]) {
  for (const { name, before, after, chapters } of [
    { name: "input seek clips and shifts chapters", before: ["-ss", "1"], after: [],
      chapters: [{ ...first, START: "0", END: "1200" }, { ...second, START: "1200", END: "2500" }] },
    { name: "input seek drops completed chapters", before: ["-ss", "2.5"], after: [],
      chapters: [{ ...second, START: "0", END: "1000" }] },
    { name: "copyts preserves chapter boundaries", before: ["-ss", "1", "-copyts"], after: [],
      chapters: [first, second] },
    { name: "output seek clips and shifts chapters", before: [], after: ["-ss", "1"],
      chapters: [{ ...first, START: "0", END: "1200" }, { ...second, START: "1200", END: "2500" }] },
    { name: "no seek preserves chapter boundaries", before: [], after: [], chapters: [first, second] },
    { name: "input and output seek compose", before: ["-ss", "1"], after: ["-ss", "0.5", "-t", "1"],
      chapters: [{ ...first, START: "0", END: "700" }, { ...second, START: "700", END: "1000" }] },
    { name: "input seek past all chapters removes them", before: ["-ss", "4"], after: [], chapters: [] }
  ]) {
    it(`${name} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.meta": input });
      const args = ["-y", "-v", "error", ...before, "-f", "ffmetadata", "-i", "/in.meta",
        ...after, "-bitexact", "-f", "ffmetadata", "/out.meta"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
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
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = volume.readFileSync("/out.meta", "utf8") as string;
      assert.ok(output.startsWith(";FFMETADATA1\n"));
      const scopes = output.slice(";FFMETADATA1\n".length).split("[CHAPTER]\n").map(section =>
        Object.fromEntries(section.trim().split("\n").map(line => {
          const equals = line.indexOf("=");
          return [line.slice(0, equals), line.slice(equals + 1)];
        })));
      assert.deepEqual(scopes, [{ title: "Album", artist: "Pat" }, ...chapters]);
    });
  }
}
