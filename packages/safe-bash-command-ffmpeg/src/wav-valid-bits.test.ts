import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";
import fixtures from "../../../tests/fixtures/media/wav-valid-bits.json" with { type: "json" };

for (const fixture of fixtures) {
  for (const sync of [false, true]) {
    it(`matches complete native s32le output for WAV ${fixture.name} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", Buffer.from(fixture.input, "hex"));
      const args = ["-v", "error", "-y", "-i", "/in.wav", "-f", "s32le", "/out.raw"];
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
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(fixture.s32le, "hex"));
    });
  }
}
