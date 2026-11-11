import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const input of [
    ";FFMETADATA1\ntitle=  take 1  \nartist=\t artist\t\ncomment=   \n",
    ";FFMETADATA1\nkey=plain\n key=leading\nkey =trailing\n\tkey\t=tabs\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=3000\nlabel=plain\n label=leading\nlabel =trailing\n\tlabel\t=tabs\n",
    ";FFMETADATA1\ntitle=plain\n title=leading\ntitle =trailing\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=3000\ntitle=plain\n title=leading\ntitle =trailing\n"
  ]) {
    it(`preserves surrounding whitespace in FFmetadata (${sync ? "sync" : "async"}): ${JSON.stringify(input)}`, async () => {
      const volume = Volume.fromJSON({ "/in.ffmeta": input });
      const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.ffmeta", "-bitexact", "-f", "ffmetadata", "/out.ffmeta"];
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
      assert.equal(volume.readFileSync("/out.ffmeta", "utf8"), input);
      volume.renameSync("/out.ffmeta", "/in.ffmeta");
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      assert.equal(volume.readFileSync("/out.ffmeta", "utf8"), input);
    });
  }
}
