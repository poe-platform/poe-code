import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) for (const bitexact of [false, true]) for (const [assignment, expected] of [
  ["title=New", "artist=Pat\ntitle=New"],
  ["artist=New", "title=Album\nartist=New"],
  [undefined, "title=Album\nartist=Pat"]
] as const) {
  it(`orders global FFmetadata tags after ${assignment ?? "no replacement"} (${sync ? "sync" : "async"}, bitexact=${bitexact})`, async () => {
    const chapters = "\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=500\nEND=2200\ntitle=First\nartist=Ann\n\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=2200\nEND=3500\ntitle=Second\nartist=Bob\n";
    const input = `;FFMETADATA1\ntitle=Album\nartist=Pat\n${chapters}`;
    const volume = Volume.fromJSON({ "/in.ffmeta": input });
    const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.ffmeta", ...(bitexact ? ["-bitexact"] : []), ...(assignment ? ["-metadata", assignment] : []), "-f", "ffmetadata", "/out.ffmeta"];
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
    assert.equal(volume.readFileSync("/out.ffmeta", "utf8"), `;FFMETADATA1\n${expected}\n${bitexact ? "" : "encoder=Lavf61.7.100\n"}${chapters.slice(1).replaceAll("\n\n", "\n")}`);
  });
}
