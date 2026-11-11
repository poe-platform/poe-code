import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { parseWav } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) for (const input of ["/in.wav", "-"]) {
  for (const output of ["chapters", "disabled", "wav"]) {
    it(`imports WAV ID3 chapters for ${output} output (${sync ? "sync" : "async"}, ${input})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": readFileSync(new URL("../../mp4-ast/src/fixtures/chapid3.wav", import.meta.url)) });
      const path = output === "wav" ? "/out.wav" : "/out.ffmeta";
      const args = ["-y", "-bitexact", "-v", "error", "-i", input,
        ...(output === "disabled" ? ["-map_chapters", "-1"] : []),
        ...(output === "wav" ? ["-c", "copy"] : ["-f", "ffmetadata"]), path];
      if (sync) {
        assert.equal(evalSyncFfmpeg(input === "-" ? volume.readFileSync("/in.wav") as Buffer : undefined, args,
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
          stdin: (async function* () { if (input === "-") yield volume.readFileSync("/in.wav") as Buffer; })(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const bytes = volume.readFileSync(path) as Buffer;
      if (output === "wav") {
        assert.equal(parseWav(bytes).chapters?.length ?? 0, 0);
      } else {
        assert.equal(bytes.toString(), output === "disabled" ? ";FFMETADATA1\n" :
          ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=250\nEND=750\ntitle=Verse\n");
      }
    });
  }
}
