import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const tailfree = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000020000000100000001000000106461746100000000000000140000000000650066006700680069006a006b006c667265650000000000000003616263", "hex");

for (const trailing of [false, true]) {
  for (const sync of [false, true]) {
    it(`decodes only CAF PCM data with trailing chunk ${trailing} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.caf", tailfree.subarray(0, trailing ? 99 : 84));
      const args = ["-v", "error", "-y", "-i", "/in.caf", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
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
          stdin: (async function* () {})(),
          stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
      }
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from("650066006700680069006a006b006c00", "hex"));
    });
  }
}
