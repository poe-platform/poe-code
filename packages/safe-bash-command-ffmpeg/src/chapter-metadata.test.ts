import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = ";FFMETADATA1\ntitle=Album\nartist=Pat\n\n" +
  "[CHAPTER]\nTIMEBASE=1/1000\nSTART=500\nEND=2200\ntitle=First\nartist=Ann\n\n" +
  "[CHAPTER]\nTIMEBASE=1/1000\nSTART=2200\nEND=3500\ntitle=Second\nartist=Bob\n";
const global = { title: "Album", artist: "Pat" };
const first = { TIMEBASE: "1/1000", START: "500", END: "2200", title: "First", artist: "Ann" };
const second = { TIMEBASE: "1/1000", START: "2200", END: "3500", title: "Second", artist: "Bob" };

for (const sync of [false, true]) {
  for (const { name, options, expected } of [
    { name: "unchanged control", options: [], expected: [global, first, second] },
    { name: "global title control", options: ["-metadata", "title=New"], expected: [{ ...global, title: "New" }, first, second] },
    { name: "implicit first chapter", options: ["-metadata:c", "title=New"], expected: [global, { ...first, title: "New" }, second] },
    { name: "case-insensitive chapter update", options: ["-metadata:c:0", "TITLE=New"], expected: [global, { TIMEBASE: "1/1000", START: "500", END: "2200", TITLE: "New", artist: "Ann" }, second] },
    { name: "case-insensitive chapter deletion", options: ["-metadata:c:1", "ARTIST="], expected: [global, first, { TIMEBASE: "1/1000", START: "2200", END: "3500", title: "Second" }] },
    { name: "chapter title update", options: ["-metadata:c:0", "title=New"], expected: [global, { ...first, title: "New" }, second] },
    { name: "chapter artist deletion", options: ["-metadata:c:1", "artist="], expected: [global, first, { TIMEBASE: "1/1000", START: "2200", END: "3500", title: "Second" }] },
    { name: "chapter title deletion", options: ["-metadata:c:0", "title="], expected: [global, { TIMEBASE: "1/1000", START: "500", END: "2200", artist: "Ann" }, second] },
    { name: "custom chapter tag", options: ["-metadata:c:1", "note=Part=Two"], expected: [global, first, { ...second, note: "Part\\=Two" }] },
    { name: "ordered chapter edits", options: ["-metadata:c:0", "title=New", "-metadata:c:0", "title=", "-metadata:c:0", "title=Last", "-metadata:c:1", "artist=Other"], expected: [global, { ...first, title: "Last" }, { ...second, artist: "Other" }] },
    { name: "output chapter index after trimming", options: ["-ss", "2.3", "-metadata:c:0", "title=Remaining"], expected: [global, { ...second, START: "0", END: "1200", title: "Remaining" }] }
  ]) {
    it(`${name} leaves other metadata intact (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.ffmeta": input });
      const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.ffmeta", ...options, "-bitexact", "-f", "ffmetadata", "/out.ffmeta"];
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
      const output = volume.readFileSync("/out.ffmeta", "utf8") as string;
      const scopes = output.slice(";FFMETADATA1\n".length).split("[CHAPTER]\n").map(section =>
        Object.fromEntries(section.trim().split("\n").map(line => {
          const equals = line.indexOf("=");
          return [line.slice(0, equals), line.slice(equals + 1)];
        })));
      assert.deepEqual(scopes, expected);
    });
  }
}

for (const options of [["-metadata:c:-1", "title=New"], ["-metadata:c:2", "title=New"], ["-map_chapters", "-1", "-metadata:c:0", "title=New"]]) {
  it(`rejects an unavailable output chapter: ${options.join(" ")}`, async () => {
    const volume = Volume.fromJSON({ "/in.ffmeta": input });
    const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.ffmeta", ...options, "-bitexact", "-f", "ffmetadata", "/out.ffmeta"];
    assert.equal(evalSyncFfmpeg(args, undefined,
      path => volume.readFileSync(path) as Buffer,
      () => { assert.fail("invalid chapter must not write output"); }), undefined);
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
    assert.ok(stderr.includes("Invalid chapter index"), stderr);
    assert.equal(volume.existsSync("/out.ffmeta"), false);
  });
}
