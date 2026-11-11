import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [assignments, expected] of [
  [["artist="], "title=Album\n"],
  [["title=New"], "title=New\nartist=Pat\n"],
  [[], "title=Album\nartist=Pat\n"],
  [["artist=", "artist=New"], "title=Album\nartist=New\n"],
  [["artist=New", "artist="], "title=Album\n"],
  [["title="], "artist=Pat\n"],
  [["album="], "title=Album\nartist=Pat\n"],
  [["missing="], "title=Album\nartist=Pat\n"]
] as const) for (const sync of [false, true]) {
  it(`applies global FFmetadata ${assignments.join(", ")} without changing chapters (${sync ? "sync" : "async"})`, async () => {
    const chapters = "\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=500\nEND=2200\ntitle=First\nartist=Ann\n" +
      "\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=2200\nEND=3500\ntitle=Second\nartist=Bob\n";
    const input = `;FFMETADATA1\ntitle=Album\nartist=Pat\n${chapters}`;
    const volume = Volume.fromJSON({ "/in.ffmeta": input });
    const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.ffmeta", ...assignments.flatMap(value => ["-metadata", value]), "-bitexact", "-f", "ffmetadata", sync ? "/out.ffmeta" : "pipe:1"];
    let stdout = "";
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
        stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    }
    const output = sync ? volume.readFileSync("/out.ffmeta", "utf8") as string : stdout;
    const [global, ...sections] = output.split("\n[CHAPTER]\n");
    assert.deepEqual(global!.trim().split("\n").slice(1).sort(), expected.trim().split("\n").sort());
    assert.deepEqual(sections.join("\n[CHAPTER]\n").split("\n").filter(Boolean),
      chapters.slice("\n[CHAPTER]\n".length).split("\n").filter(Boolean));
  });
}
