import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Unchanged native CAF fixtures: eight PCM samples despite differing packet counts.
const cases = [
  { name: "fixedcount.caf", duration: 3, hex: "636166660001000064657363000000000000002040bf4000000000006c70636d000000000000000200000001000000010000001070616b7400000000000000180000000000000003000000000000000800000000000000006461746100000000000000140000000000650066006700680069006a006b006c" },
  { name: "none.caf", duration: 0, hex: "636166660001000064657363000000000000002040bf4000000000006c70636d000000000000000200000001000000010000001070616b7400000000000000180000000000000000000000000000000000000000000000006461746100000000000000140000000000650066006700680069006a006b006c" },
  { name: "plain.caf", duration: 8, hex: "636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000020000000100000001000000106461746100000000000000140000000000650066006700680069006a006b006c" }
];

for (const { name, hex } of cases) {
  for (const sync of [false, true]) {
    it(`decodes every PCM sample from ${name} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.caf", Buffer.from(hex, "hex"));
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
      }
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from("650066006700680069006a006b006c00", "hex"));
    });
  }
}
