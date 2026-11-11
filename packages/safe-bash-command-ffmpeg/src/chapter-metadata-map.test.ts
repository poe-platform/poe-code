import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = ";FFMETADATA1\ntitle=Album\nartist=Pat\n\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=500\nEND=2200\ntitle=First\nartist=Ann\n\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=2200\nEND=3500\ntitle=Second\nartist=Bob\n";
const cleared = ";FFMETADATA1\n\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=500\nEND=2200\n\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=2200\nEND=3500\n";
const cases = [
  { name: "global control", options: ["-map_metadata", "0"], output: input },
  { name: "first chapter suppression", options: ["-map_metadata:c:0", "-1"], output: cleared },
  { name: "second chapter suppression", options: ["-map_metadata:c:1", "-1"], output: cleared },
  { name: "default chapter suppression", options: ["-map_metadata:c", "-1"], output: cleared },
  { name: "unused chapter index suppression", options: ["-map_metadata:c:99", "-1"], output: cleared },
  { name: "explicit global mapping", options: ["-map_metadata:c:0", "-1", "-map_metadata", "0"],
    output: cleared.replace(";FFMETADATA1\n", ";FFMETADATA1\ntitle=Album\nartist=Pat\n") },
  { name: "chapter-only source suppression", options: ["-map_metadata:c:0", "-1:c"],
    output: cleared.replace(";FFMETADATA1\n", ";FFMETADATA1\ntitle=Album\nartist=Pat\n") },
  { name: "explicit chapter assignment", options: ["-map_metadata:c:0", "-1", "-metadata:c:1", "title=Edited"],
    output: cleared + "title=Edited\n" },
  { name: "positive chapter mapping", options: ["-map_metadata:c:0", "0:c:1"], output: undefined }
];
for (const sync of [false, true]) {
  for (const { name, options, output } of cases) {
    it(`maps chapter metadata: ${name} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.meta": input });
      const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.meta", ...options,
        "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), output === undefined ? undefined : "");
        if (output !== undefined) assert.equal(String(volume.readFileSync("/out.meta", "utf8")).split("\n").filter(Boolean).join("\n"), output.split("\n").filter(Boolean).join("\n"));
        else assert.equal(volume.existsSync("/out.meta"), false);
      } else {
        let stdout = "";
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, output === undefined ? 234 : 0, stderr);
        assert.equal(stdout.split("\n").filter(Boolean).join("\n"), (output ?? "").split("\n").filter(Boolean).join("\n"));
        if (output === undefined) assert.ok(stderr.includes("Invalid chapter index"), stderr);
      }
      assert.equal(volume.readFileSync("/in.meta", "utf8"), input);
    });
  }
}
