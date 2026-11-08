import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAvi } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = new Uint8Array(readFileSync(new URL("../../mp4-ast/src/fixtures/stream-names.avi", import.meta.url)));

for (const [maps, edits, titles] of [
  [["0:a:0"], [], ["Alice"]],
  [["0:a:0"], ["-metadata:s:a:0", "title=Charlie"], ["Charlie"]],
  [["0:a:1", "0:a:0"], ["-metadata:s:a:1", "title=Chloé"], ["Bob", "Chloé"]],
  [["0:a"], ["-metadata:s:a:0", "title="], [undefined, "Bob"]]
] as const) {
  it(`copies AVI stream names with ${maps} and ${edits}`, async () => {
    const files = new Map<string, Uint8Array>([["/in.avi", input]]);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.avi", ...maps.flatMap(map => ["-map", map]), "-c", "copy", ...edits, "/out.avi"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return files.get(path)!; },
        async writeFile(path: string, bytes: Uint8Array) { files.set(path, bytes); },
        async stat(path: string) {
          if (!files.has(path)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
          return { type: "file", size: files.get(path)!.length, mode: 0o644, mtimeMs: 0 };
        }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const actual = parseAvi(files.get("/out.avi")!);
    assert.equal(actual.metadata.title, "Meeting");
    assert.deepEqual(actual.tracks.map(track => track.metadata?.title), titles);
    const source = parseAvi(input);
    const order = maps[0] === "0:a:1" ? [1, 0] : titles.map((_, index) => index);
    for (const [index, track] of actual.tracks.entries()) {
      assert.equal(track.codecDescriptions[0]!.codecName, "aac");
      assert.deepEqual(track.samples.map(sample => sample.data),
        source.tracks[order[index]!]!.samples.map(sample => sample.data));
    }
  });
}

for (const title of ["Charlie", ""]) {
  it(`edits AVI stream names synchronously to ${JSON.stringify(title)}`, () => {
    const files = new Map<string, Uint8Array>([["/in.avi", input]]);
    assert.equal(evalSyncFfmpeg(["-i", "/in.avi", "-c", "copy", "-metadata:s:a:0", `title=${title}`, "/out.avi"],
      undefined, path => files.get(path)!,
      (path, bytes) => { files.set(path, bytes); return true; }), "");
    const actual = parseAvi(files.get("/out.avi")!);
    assert.equal(actual.tracks[0]!.metadata?.title, title || undefined);
    assert.equal(actual.metadata.title, "Meeting");
  });
}
