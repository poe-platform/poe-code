import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const partial of [false, true]) {
  for (const strict of [false, true]) {
    for (const copy of [false, true]) {
      it(`AIFF PCM partial=${partial}, strict=${strict}, copy=${copy}`, async () => {
        const bytes = Buffer.from(partial
          ? "464f524d0000003441494646434f4d4d000000120001000000020010400bfa0000000000000053534e440000000d00000000000000001234fedc7f00"
          : "464f524d0000003441494646434f4d4d000000120001000000020010400bfa0000000000000053534e440000000c00000000000000001234fedc", "hex");
        const volume = Volume.fromJSON({ "/out.raw": "keep" });
        volume.writeFileSync("/in.aiff", bytes);
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", ...(strict ? ["-xerror"] : []), "-i", "/in.aiff", "-c:a", copy ? "copy" : "pcm_s16be", "-f", "s16be", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(name: string) { return volume.readFileSync(name); },
            async writeFile(name: string, data: Uint8Array) { volume.writeFileSync(name, data); },
            async stat(name: string) { return volume.statSync(name); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode === 0, !(partial && strict && !copy), stderr);
        assert.equal(stderr.includes("Invalid PCM packet"), partial && !copy, stderr);
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"),
          partial && copy ? "1234fedc7f" : "1234fedc");
      });
    }
  }
}
