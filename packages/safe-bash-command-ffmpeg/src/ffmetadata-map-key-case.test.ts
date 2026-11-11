import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const secondKey of ["x-NOTE", "X-note"]) {
    for (const sources of [[0, 1], [1, 0]]) {
      for (const duplicate of [false, true]) {
        it(`keeps the first mapped custom key ${secondKey}, maps ${sources}, same-input duplicate=${duplicate} (${sync ? "sync" : "async"})`, async () => {
          const first = `;FFMETADATA1\n${duplicate ? "x-note=old\n" : ""}X-note=first\n`;
          const second = `;FFMETADATA1\n${secondKey}=second\nextra=hi\n`;
          const volume = Volume.fromJSON({ "/a.meta": first, "/b.meta": second });
          const args = ["-y", "-v", "error", "-i", "/a.meta", "-i", "/b.meta",
            ...sources.flatMap(source => ["-map_metadata", String(source)]),
            "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
          let output = "";
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
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
          assert.equal(output, `;FFMETADATA1\n${sources[0] === 0 ? "X-note=first" : `${secondKey}=second`}\nextra=hi\n`);
          assert.equal(volume.readFileSync("/a.meta", "utf8"), first);
          assert.equal(volume.readFileSync("/b.meta", "utf8"), second);
        });
      }
    }
  }
}
