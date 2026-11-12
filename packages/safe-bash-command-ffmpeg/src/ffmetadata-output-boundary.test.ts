import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const option of ["-t", "-to"]) {
    for (const { end, input, expected } of [
      ...[1499, 1500, 1501].map(end => ({
        end,
        input: ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1500\nEND=2000\ntitle=Intro\n",
        expected: ";FFMETADATA1\n" + (end < 1500 ? "" :
          `[CHAPTER]\nTIMEBASE=1/1000\nSTART=1500\nEND=${end}\ntitle=Intro\n`)
      })),
      ...[true, false].map(laterFirst => {
        const later = "[CHAPTER]\nTIMEBASE=1/10\nSTART=10\nEND=20\ntitle=Later\n";
        const earlier = "[CHAPTER]\nTIMEBASE=1/10\nSTART=0\nEND=8\ntitle=Earlier\n";
        return {
          end: 200,
          input: ";FFMETADATA1\n" + (laterFirst ? later + earlier : earlier + later),
          expected: ";FFMETADATA1\n" + (laterFirst ? "" :
            "[CHAPTER]\nTIMEBASE=1/10\nSTART=0\nEND=2\ntitle=Earlier\n")
        };
      })
    ]) {
      it(`clips chapters at ${option} ${end / 1000} (${sync ? "sync" : "async"}, ${input.includes("title=Later\n[CHAPTER]") ? "later first" : "ordered"})`, async () => {
        const volume = Volume.fromJSON({
          "/a.meta": input
        });
        const args = ["-v", "error", ...(sync ? ["-y", "-f", "ffmetadata"] : []), "-i", "/a.meta", option, String(end / 1000),
          "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          assert.equal(volume.readFileSync("/out.meta", "utf8"), expected);
        } else {
          let stdout = "";
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
          assert.equal(result.exitCode, 0);
          assert.equal(stderr, "");
          assert.equal(stdout, expected);
        }
      });
    }
  }
}
