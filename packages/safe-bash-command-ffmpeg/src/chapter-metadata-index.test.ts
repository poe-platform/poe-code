import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseFfmetadata } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = ";FFMETADATA1\ntitle=Album\nartist=Pat\n" +
  "\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=500\nEND=2200\ntitle=First\nartist=Ann\n" +
  "\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=2200\nEND=3500\ntitle=Second\nartist=Bob\n";

for (const sync of [false, true]) {
  for (const target of sync ? ["/out.meta"] : ["pipe:1", "/out.meta"]) {
    for (const index of [undefined, 0, 1, 2, 4]) {
      it(`targets chapter metadata index ${index} (${sync ? "sync" : "async"}, ${target})`, async () => {
        const volume = Volume.fromJSON({ "/in.meta": input });
        const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.meta",
          ...(index === undefined ? [] : [`-metadata:c:${index}`, "title=x"]),
          "-bitexact", "-f", "ffmetadata", target];
        const invalid = index !== undefined && index >= 2;
        let stdout = "";
        let stderr = "";
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          if (invalid) {
            assert.equal(result, undefined, "invalid chapters must fall back to async validation");
            assert.equal(volume.existsSync(target), false);
            return;
          }
          assert.notEqual(result, undefined);
          stdout = result!;
        } else {
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
          assert.equal(result.exitCode, invalid ? 234 : 0, stderr);
          if (invalid) {
            assert.equal(stdout, "");
            assert.ok(stderr.includes(`Invalid chapter index ${index}`), stderr);
            assert.equal(volume.existsSync("/out.meta"), false);
            return;
          }
          assert.equal(stderr, "");
        }
        const expected = index === undefined ? input
          : input.replace(index === 0 ? "title=First" : "title=Second", "title=x");
        const output = target === "pipe:1" ? stdout : volume.readFileSync(target, "utf8") as string;
        const actualDoc = parseFfmetadata(new TextEncoder().encode(output));
        const expectedDoc = parseFfmetadata(new TextEncoder().encode(expected));
        assert.deepEqual(actualDoc.metadata, expectedDoc.metadata);
        assert.deepEqual(actualDoc.chapters, expectedDoc.chapters);
      });
    }
  }
}
