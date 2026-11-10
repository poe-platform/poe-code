import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { mkvAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";
import fixtures from "../../../tests/fixtures/media/wav-id3.json" with { type: "json" };

for (const [name, hex] of Object.entries(fixtures)) {
  for (const sync of [false, true]) for (const copy of [false, true]) {
    for (const mode of ["preserve", "edit", "suppress"]) {
      it(`imports WAV ID3: ${name}, sync=${sync}, copy=${copy}, ${mode}`, async () => {
        const volume = Volume.fromJSON({ "/input.wav": Buffer.from(hex, "hex") });
        const args = ["-v", "error", "-y", "-i", "/input.wav",
          ...(mode === "edit" ? ["-metadata", "title=Edited"] : mode === "suppress" ? ["-map_metadata", "-1"] : []),
          ...(copy ? ["-c", "copy", "-f", "matroska"] : ["-f", "ffmetadata"]), "/output"];
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
        const bytes = volume.readFileSync("/output") as Buffer;
        const tags = copy ? mkvAst().parse(bytes).metadata ?? {}
          : Object.fromEntries(bytes.toString().trim().split("\n").slice(1).map(line => line.split("=")));
        assert.equal(tags.title, mode === "suppress" ? undefined : mode === "edit" ? "Edited" : name === "before" ? "RIFF title" : "Title from ID3");
        assert.equal(tags.artist, mode === "suppress" ? undefined : name === "before" ? "RIFF artist" : "Artist from ID3");
      });
    }
  }
}
